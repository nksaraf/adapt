import {
    GraphQLBoolean,
    GraphQLFieldConfig,
    GraphQLFieldConfigArgumentMap,
    GraphQLFieldConfigMap,
    GraphQLFieldResolver,
    GraphQLFloat,
    GraphQLInputObjectType,
    GraphQLInputType,
    GraphQLInt,
    GraphQLList,
    GraphQLNonNull,
    GraphQLObjectType,
    GraphQLOutputType,
    GraphQLScalarType,
    GraphQLSchema,
    GraphQLString,
    GraphQLTypeResolver,
    isObjectType
} from "graphql";

import GraphQLJSON = require("graphql-type-json");
import * as ld from "lodash";
import * as util from "util";
import {
    isRef,
    Swagger2,
    Swagger2Operation,
    Swagger2Parameter,
    Swagger2Ref,
    Swagger2Schema
} from "../../src/swagger2gql/swagger_types";
import { TypeResolver } from "../../src/swagger2gql/type_resolver";

interface LTypeResolver {
    input: TypeResolver<GraphQLInputType>;
    output: TypeResolver<GraphQLOutputType>;
}

function isComplexType(schema: Swagger2Schema): boolean {
    return schema.type === "object" || schema.type === "array";
}

interface Fields<T> {
    [name: string]: {
        description?: string;
        type: T;
    };
}

function buildFieldsFromSchema(
    baseName: string,
    schema: Swagger2Schema,
    tyResolver: LTypeResolver,
    inputType: true): (() => Fields<GraphQLInputType>) | GraphQLInputType;
function buildFieldsFromSchema(
    baseName: string,
    schema: Swagger2Schema,
    tyResolver: LTypeResolver,
    inputType: false): (() => Fields<GraphQLOutputType>) | GraphQLOutputType;
function buildFieldsFromSchema(
    baseName: string,
    schema: Swagger2Schema,
    tyResolver: LTypeResolver,
    inputType: boolean): (() => Fields<GraphQLInputType | GraphQLOutputType>) | GraphQLInputType | GraphQLOutputType;
function buildFieldsFromSchema(
    baseName: string,
    schema: Swagger2Schema,
    tyResolverIn: LTypeResolver,
    inputType: boolean): (() => Fields<GraphQLInputType | GraphQLOutputType>) | GraphQLInputType | GraphQLOutputType {

    const properties = schema.properties;
    //FIXME(manishv) add a unit test for these two cases below, do not rely on k8s tests
    if (properties === undefined) return GraphQLJSON;
    if (Object.keys(properties).length === 0) return GraphQLJSON;

    return () => {
        const tyResolver = inputType ? tyResolverIn.input : tyResolverIn.output;
        const ret: Fields<GraphQLInputType | GraphQLOutputType> = {};
        const required = schema.required ? schema.required : [];
        for (const propName in properties) {
            if (!Object.hasOwnProperty.call(properties, propName)) continue;
            const prop = properties[propName];
            const nonNull = required.find((val) => val === propName) !== undefined;
            const baseType = isRef(prop) ?
                tyResolver.getType(prop.$ref)
                : jsonSchema2GraphQLType(baseName + "_" + propName, prop, tyResolverIn, inputType);
            const type = nonNull ? new GraphQLNonNull(baseType) : baseType;
            ret[makeGQLFieldName(propName)] = {
                description: schema.description,
                type
            };
        }
        if (Object.keys(ret).length === 0) {
            throw new Error("Internal Error: no fields, how'd we get here??");
        }
        return ret;
    };
}

function makeGQLTypeName(swaggerName: string) {
    //FIXME(manishv) make robust removing all legal swagger characters that are illegal in graphql
    let gqlName = swaggerName.replace("#/definitions/", "");
    gqlName = gqlName.replace(/[\/\.-]/g, "_");

    return gqlName;
}

function makeGQLFieldName(swaggerName: string) {
    //FIXME(manishv) make robust removing all legal swagger characters that are illegal in graphql
    const gqlName = swaggerName.replace(/\$/, "dollar_");
    return gqlName;
}

function jsonSchema2GraphQLType(
    name: string,
    schema: Swagger2Schema,
    tyResolver: LTypeResolver,
    inputType: true): GraphQLInputType;
function jsonSchema2GraphQLType(
    name: string,
    schema: Swagger2Schema,
    tyResolver: LTypeResolver,
    inputType: false): GraphQLOutputType;
function jsonSchema2GraphQLType(
    name: string,
    schema: Swagger2Schema,
    tyResolver: LTypeResolver,
    inputType: boolean): GraphQLInputType | GraphQLOutputType;
function jsonSchema2GraphQLType(
    name: string,
    schema: Swagger2Schema,
    tyResolverIn: LTypeResolver,
    inputType: boolean): GraphQLInputType | GraphQLOutputType {
    const tyResolver = inputType ? tyResolverIn.input : tyResolverIn.output;

    if (schema.type === "array") {
        const items = schema.items;
        if (!items) throw new Error(`Saw array schema with no items: ${util.inspect(schema)}`);
        if (isRef(items)) {
            return new GraphQLList(tyResolver.getType(items.$ref));
        }
        if (isComplexType(items)) {
            return new GraphQLList(jsonSchema2GraphQLType(name, items, tyResolverIn, inputType));
        }
        return new GraphQLList(tyResolver.getType(items.type));
    }

    const primitive = isPrimitive(schema.type) ? tyResolver.getType(schema.type) : undefined;
    if (primitive) return primitive;

    const gqlName = makeGQLTypeName(name);
    const consArgs = {
        name: gqlName,
        description: schema.description,
    };

    if (inputType) {
        const fields = buildFieldsFromSchema(name, schema, tyResolverIn, true);
        if (!ld.isFunction(fields)) return fields;
        return new GraphQLInputObjectType({ ...consArgs, fields });
    } else {
        //FIXME(manishv) attach resolvers somewhere
        const fields = buildFieldsFromSchema(name, schema, tyResolverIn, false);
        if (!ld.isFunction(fields)) return fields;
        return new GraphQLObjectType({ ...consArgs, fields });
    }
}

function getDef(schema: Swagger2, tyName: string) {
    if (!tyName.startsWith("#/definitions/")) return;
    const defs = schema.definitions;
    if (!defs) return;
    const baseTyName = tyName.replace("#/definitions/", "");
    return defs[baseTyName];
}

function resolveType(
    swagger: Swagger2,
    tyName: string,
    tyResolver: LTypeResolver,
    input: true): GraphQLInputType;
function resolveType(
    swagger: Swagger2,
    tyName: string,
    tyResolver: LTypeResolver,
    input: false): GraphQLOutputType;
function resolveType(
    swagger: Swagger2,
    tyName: string,
    tyResolver: LTypeResolver,
    input: boolean): GraphQLInputType | GraphQLOutputType;
function resolveType(swagger: Swagger2, tyName: string, tyResolver: LTypeResolver, input: boolean) {
    const schema = getDef(swagger, tyName);
    if (schema === undefined) throw new Error(`Unable to find type '${tyName}'`);
    return jsonSchema2GraphQLType(tyName, schema, tyResolver, input);
}

const primitiveTypes = {
    integer: GraphQLInt,
    number: GraphQLFloat,
    string: GraphQLString,
    boolean: GraphQLBoolean,
    _Empty: {
        input: GraphQLJSON,
        output: GraphQLJSON
    }
};

function isPrimitive(tyName: string) {
    return Object.hasOwnProperty.call(primitiveTypes, tyName);
}

function populateBasicSwaggerTypes(tyResolver: LTypeResolver) {
    for (const nameI in primitiveTypes) {
        if (!Object.hasOwnProperty.call(primitiveTypes, nameI)) continue;
        const name = nameI as keyof (typeof primitiveTypes);
        const typ = primitiveTypes[name];
        const inTyp = "input" in typ ? typ.input : typ;
        const outTyp = "output" in typ ? typ.output : typ;
        tyResolver.input.addType(name, inTyp);
        tyResolver.output.addType(name, outTyp);
    }
}

function getParameterInfo(
    param: Swagger2Parameter,
    tyResolver: LTypeResolver) {
    if (param.in === "body") {
        throw new Error("Body parameters not supported");
    } else {
        return {
            type: tyResolver.input.getType(param.type),
            required: param.required ? param.required : false,
            default: param.default
        };
    }
}

function buildArgsForOperation(
    _operationId: string | undefined,
    parameters: (Swagger2Parameter | Swagger2Ref)[],
    tyResolver: LTypeResolver): GraphQLFieldConfigArgumentMap | undefined {

    if (parameters.length === 0) return;

    const ret: GraphQLFieldConfigArgumentMap = {};
    for (const param of parameters) {
        if (isRef(param)) throw new Error("Refs in parameters not yet supported");
        const info = getParameterInfo(param, tyResolver);
        const defaultValue = param.in === "body" ? undefined : param.default;
        ret[param.name] = {
            type: (info.required ? new GraphQLNonNull(info.type) : info.type),
            defaultValue
        };
    }
    return ret;
}

function responseTypeForOperation(
    op: Swagger2Operation,
    tyResolver: LTypeResolver): GraphQLOutputType {

    const okResponse = op.responses["200"]; //FIXME(manishv) deal with other non-error responses here
    if (okResponse === undefined) return tyResolver.output.getType("_Empty");
    const schema = okResponse.schema;
    if (schema === undefined) return GraphQLJSON;
    if (isRef(schema)) {
        return tyResolver.output.getType(schema.$ref);
    } else {
        return jsonSchema2GraphQLType(op.operationId + "_Response", schema, tyResolver, false);
    }
}

function buildQueryField(
    op: Swagger2Operation,
    itemParams: (Swagger2Parameter | Swagger2Ref)[] | undefined,
    tyResolver: LTypeResolver): GraphQLFieldConfig<unknown, unknown> {
    const iparams = itemParams ? itemParams : [];
    const oparams = op.parameters ? op.parameters : [];
    return {
        type: responseTypeForOperation(op, tyResolver),
        args: buildArgsForOperation(op.operationId, [...iparams, ...oparams], tyResolver)
    };
}

function buildQueryFields(
    swagger: Swagger2,
    tyResolver: LTypeResolver): GraphQLFieldConfigMap<unknown, unknown> {

    const ret: GraphQLFieldConfigMap<unknown, unknown> = {};
    for (const swagPath in swagger.paths) {
        if (!Object.hasOwnProperty.call(swagger.paths, swagPath)) continue;
        const pathItem = swagger.paths[swagPath];
        const op = pathItem.get;
        if (op === undefined) continue;
        if (op.operationId === undefined) continue; //FIXME(manishv) should we compute a name here?
        ret[makeGQLFieldName(op.operationId)] = buildQueryField(op, pathItem.parameters, tyResolver);
    }
    return ret;
}

function buildQueryObject(swagger: Swagger2): GraphQLObjectType {
    const tyResolver: LTypeResolver = {
        input: new TypeResolver<GraphQLInputType>((n) => resolveType(swagger, n, tyResolver, true)),
        output: new TypeResolver<GraphQLOutputType>((n) => resolveType(swagger, n, tyResolver, false))
    };

    populateBasicSwaggerTypes(tyResolver);

    const fields = buildQueryFields(swagger, tyResolver);
    return new GraphQLObjectType({
        name: "Query",
        fields
    });
}

type GQLFieldResolver<ObjectT = unknown, Context = unknown, Args = { [name: string]: unknown }> =
    GraphQLFieldResolver<ObjectT, Context, Args>;
type GQLTypeResolver<ObjectT = unknown, Context = unknown> = GraphQLTypeResolver<ObjectT, Context>;
type FieldResolverFactory = (ty: GraphQLObjectType, field: string, isQueryType: boolean)
    => GQLFieldResolver | undefined;
type TypeResolverFactory = (ty: GraphQLScalarType, field: undefined, isQueryType: boolean)
    => GQLTypeResolver | undefined;
export interface ResolverFactory {
    fieldResolvers?: FieldResolverFactory;
    typeResolvers?: TypeResolverFactory;
}

function addResolversToFields(
    seen: Set<GraphQLObjectType>,
    obj: GraphQLObjectType,
    getResolver: ResolverFactory,
    isQuery: boolean = false): void {

    if (seen.has(obj)) return;
    seen.add(obj);

    const fields = obj.getFields();
    for (const fieldName in fields) {
        if (!Object.hasOwnProperty.call(fields, fieldName)) continue;
        const field = fields[fieldName];
        const fieldResolvers = getResolver.fieldResolvers;
        const resolver = fieldResolvers ? fieldResolvers(obj, fieldName, isQuery) : undefined;
        field.resolve = resolver;
        const fieldType = field.type;
        if (isObjectType(fieldType)) {
            addResolversToFields(seen, fieldType, getResolver, false);
        }
        //FIXME(manishv) How to deal with custom scalar types?
    }
}

function addResolversToSchema(schema: GraphQLSchema, getResolver: ResolverFactory): void {
    const queryType = schema.getQueryType();
    if (!queryType) return;
    addResolversToFields(new Set<GraphQLObjectType>(), queryType, getResolver, true);
    return;
}

export function buildGraphQLSchema(
    swagger: Swagger2,
    getResolver?: ResolverFactory): GraphQLSchema {
    const qobj = buildQueryObject(swagger);
    const schema = new GraphQLSchema({ query: qobj });
    if (getResolver) addResolversToSchema(schema, getResolver);
    return schema;
}