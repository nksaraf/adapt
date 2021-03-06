/*
 * Copyright 2018-2019 Unbounded Systems, LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as ld from "lodash";
import should from "should";
import Adapt, {
    BuildData,
    BuildHelpers,
    Component,
    createStateStore,
    gql,
    Group,
    handle,
    Handle,
    ObserveForStatus,
    PrimitiveComponent,
} from "../src";
import MockObserver from "../src/observers/MockObserver";
import { deepFilterElemsToPublic, Empty } from "./testlib";

class PrimitiveMockStatus extends PrimitiveComponent<{}, {}> {
    async status(observe: ObserveForStatus<any>) {
        const obs = await observe(MockObserver, gql`{ mockById(id: 10) { idSquared } }`);
        if (!obs) return undefined;
        return obs.mockById;
    }
}

class MockStatus extends Component<{}, {}> {
    async status(observe: ObserveForStatus<any>) {
        const obs = await observe(MockObserver, gql`{ mockById(id: 5) { idSquared } }`);
        if (!obs) return undefined;
        return obs.mockById;
    }

    build() {
        return <PrimitiveMockStatus key={this.props.key} />;
    }
}

class BogusObserve extends PrimitiveComponent<{}, {}> {
    async status(observe: ObserveForStatus<any>) {
        const obs = await observe({ observerName: "doesNotExist" }, gql`{ foo }`);
        return obs;
    }
}

// tslint:disable-next-line:variable-name
const MockSFC: Adapt.SFC<{}> = (props) => {
    return <PrimitiveMockStatus key={props.key} />;
};
MockSFC.status = async (props: {}, observe: ObserveForStatus<any>, buildData: BuildData) => {
    const obs = await observe(MockObserver, gql`{ mockById(id: 8) { idSquared } }`);
    if (!obs) return undefined;
    return obs.mockById;
    should(deepFilterElemsToPublic(buildData.successor)
        .eql(deepFilterElemsToPublic(MockSFC({} as any))));
};

describe("Observation for component status", () => {
    it("should allow primitive component to observe", async () => {
        const root = <PrimitiveMockStatus />;
        const { mountedOrig } = await Adapt.build(root, null);
        if (mountedOrig === null) throw should(mountedOrig).not.Null();
        should(ld.clone(await mountedOrig.status())).eql({ idSquared: 100 });
    });

    it("should allow component to observe", async () => {
        const root = <MockStatus key="mock" />;
        const { mountedOrig } = await Adapt.build(root, null);
        if (mountedOrig === null) throw should(mountedOrig).not.Null();
        should(ld.clone(await mountedOrig.status())).eql({ idSquared: 25 });

        const ref = deepFilterElemsToPublic(<PrimitiveMockStatus key="mock" />);
        should(deepFilterElemsToPublic(mountedOrig.buildData.successor)).eql(ref);
    });

    it("should allow SFC component to observe", async () => {
        const root = <MockSFC key="mock" />;
        const { mountedOrig } = await Adapt.build(root, null);
        if (mountedOrig === null) throw should(mountedOrig).not.Null();
        should(ld.clone(await mountedOrig.status())).eql({ idSquared: 64 });

        const ref = deepFilterElemsToPublic(<PrimitiveMockStatus key="mock" />);
        should(deepFilterElemsToPublic(mountedOrig.buildData.successor)).eql(ref);
    });

    it("should error on invalid observer", async () => {
        const root = <BogusObserve />;
        const { mountedOrig } = await Adapt.build(root, null);
        if (mountedOrig === null) throw should(mountedOrig).not.Null();
        return should(mountedOrig.status()).rejectedWith(/Cannot find observer doesNotExist/);
    });
});

import { isElementImpl } from "../src/jsx";
import { createObserverManagerDeployment } from "../src/observers";

class StatusGetter extends Component<{ ref: Handle }, { data?: any }> {
    initialState() { return { data: "bogus" }; }
    build(helpers: BuildHelpers) {
        this.setState(async () => ({ data: await helpers.elementStatus(this.props.ref) }));
        return <Empty id={1} />;
    }
}

function MakePrimitiveMockStatus() {
    return <PrimitiveMockStatus />;
}

function MakeNull() { return null; }

// DEBUG
// tslint:disable: no-console

describe("Default status calculation", () => {
    it("Should return noStatus for childless primitives", async () => {
        const root = <Group />;
        const { mountedOrig } = await Adapt.build(root, null);
        if (mountedOrig === null) throw should(mountedOrig).not.Null();
        should(await mountedOrig.status()).eql({ noStatus: "element has no children" });
    });

    it("Should return child status for primitives with children", async () => {
        const root = <Group><PrimitiveMockStatus /></Group>;
        const { mountedOrig } = await Adapt.build(root, null);
        if (mountedOrig === null) throw should(mountedOrig).not.Null();
        should(ld.cloneDeep(await mountedOrig.status())).eql({ childStatus: [{ idSquared: 100 }] });
    });

    it("Should return successor status for elements with successors", async () => {
        const root = <MakePrimitiveMockStatus />;
        const { mountedOrig } = await Adapt.build(root, null);
        if (mountedOrig === null) throw should(mountedOrig).not.Null();
        should(ld.cloneDeep(await mountedOrig.status())).eql({ idSquared: 100 });
    });

    it("Should return successor status for elements that build to null", async () => {
        console.time("PREV");
        const root = <MakeNull />;
        const { mountedOrig } = await Adapt.build(root, null);
        if (mountedOrig === null) throw should(mountedOrig).not.Null();
        should(await mountedOrig.status()).eql({ noStatus: "successor was null" });
        console.timeEnd("PREV");
    });

});

describe("Build Helper elementStatus", () => {
    it("Should return undefined with no observations", async () => {
        console.time("HELPER1");
        const observerPlugin = new MockObserver();
        const stateStore = createStateStore();
        const mgr = createObserverManagerDeployment();
        const observations = await observerPlugin.observe([]);
        mgr.registerSchema(MockObserver, observerPlugin.schema, observations);

        const h = handle();
        const root = <Group>
            <PrimitiveMockStatus handle={h} />
            <StatusGetter ref={h} />
        </Group>;

        const { contents: dom, messages, mountedOrig } =
            await Adapt.build(root, null, { observerManager: mgr, stateStore });
        should(messages).empty();
        should(dom).not.Null();
        if (mountedOrig === null) throw should(mountedOrig).not.Null();
        const statusGetter = mountedOrig.buildData.origChildren![1];
        if (!isElementImpl(statusGetter)) throw should(isElementImpl(statusGetter)).True();
        should(stateStore.elementState(statusGetter.stateNamespace)).eql({
            data: undefined
        });
        console.timeEnd("HELPER1");
    });

    it("Should return status with observations", async () => {
        console.time("HELPER2");
        const observerPlugin = new MockObserver();
        const stateStore = createStateStore();
        const mgr = createObserverManagerDeployment();
        const observations = await observerPlugin.observe([{ query: gql`{ mockById(id: 10) { idSquared } }` }]);
        mgr.registerSchema(MockObserver, observerPlugin.schema, observations);

        const h = handle();
        const root = <Group>
            <PrimitiveMockStatus handle={h} />
            <StatusGetter ref={h} />
        </Group>;
        const { contents: dom, messages, mountedOrig } =
            await Adapt.build(root, null, { observerManager: mgr, stateStore });
        should(messages).empty();
        should(dom).not.Null();
        should(messages).empty();
        should(dom).not.Null();
        if (mountedOrig === null) throw should(mountedOrig).not.Null();
        const statusGetter = mountedOrig.buildData.origChildren![1];
        if (!isElementImpl(statusGetter)) throw should(isElementImpl(statusGetter)).True();
        should(ld.cloneDeep(stateStore.elementState(statusGetter.stateNamespace))).eql({ data: { idSquared: 100 } });
        console.timeEnd("HELPER2");
    });
});
