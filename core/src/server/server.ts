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

import { isInstance, tagConstructor } from "@adpt/utils";
import { CustomError } from "ts-custom-error";
import { URL } from "url";
import { HistoryStore } from "./history";

export const $serverLock = Symbol.for("$serverLock");

export interface ServerLock {
    // Implementation details are private to each server implementation
    [$serverLock]: true;
}

export interface AdaptServer {
    init(): Promise<void>;
    destroy(): Promise<void>;

    set(dataPath: string, val: any, options?: SetOptions): Promise<void>;
    get(dataPath: string, options?: GetOptions): Promise<any>;
    delete(dataPath: string, options?: DeleteOptions): Promise<void>;
    lock(): Promise<ServerLock>;
    unlock(lock: ServerLock): Promise<void>;
    historyStore(dataPath: string, init: boolean): Promise<HistoryStore>;
}

export interface OptionsWithLock {
    lock?: ServerLock;
}

export interface SetOptions extends OptionsWithLock {
    mustCreate?: boolean;
}

export interface GetOptions extends OptionsWithLock {
}

export interface DeleteOptions extends OptionsWithLock {
}

export interface ServerOptions {
}

export interface AdaptServerType {
    urlMatch: RegExp;
    new (url: URL, options: ServerOptions): AdaptServer;
}

// Exported for testing only
let serverTypes: AdaptServerType[] = [];

export function mockServerTypes_(sTypes?: AdaptServerType[]) {
    const oldTypes = serverTypes;
    if (sTypes != null) serverTypes = sTypes;
    return oldTypes;
}

export function register(serverType: AdaptServerType) {
    serverTypes.push(serverType);
}

export async function adaptServer(url: string, options: ServerOptions): Promise<AdaptServer> {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch (err) {
        if (err instanceof TypeError) {
            throw new Error(`Invalid Adapt server url '${url}'`);
        }
        throw err;
    }

    for (const sType of serverTypes) {
        if (sType.urlMatch.test(url)) {
            const server = new sType(parsed, options);
            await server.init();
            return server;
        }
    }
    throw new Error(`Adapt server url '${url}' is not a supported url type.`);
}

export async function withLock<T>(server: AdaptServer, f: (l: ServerLock) => Promise<T>): Promise<T> {
    const lock = await server.lock();
    try {
        return await f(lock);
    } finally {
        await server.unlock(lock);
    }
}

export class ServerPathExists extends CustomError {
    public constructor(public path: string) {
        super(`Server: path '${path}' already exists`);
    }
}
tagConstructor(ServerPathExists, "adapt");

export function isServerPathExists(val: any): val is ServerPathExists {
    return isInstance(val, ServerPathExists, "adapt");
}
