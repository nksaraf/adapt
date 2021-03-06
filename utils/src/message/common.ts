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

import ee2, { EventEmitter2, eventNS, Listener, ListenerFn, OnOptions } from "eventemitter2";
import * as stream from "stream";
import { hasValidProps, validateProps, ValidationError } from "../type_check";

export type Logger = (arg: any, ...args: any[]) => void;

export enum MessageType {
    info = "info",
    warning = "warning",
    error = "error",
    task = "task",
    stdout = "stdout",
    stderr = "stderr",
}

export interface Message {
    type: MessageType;
    timestamp: number;
    from: string;
    content: string;
}

const msgProps = {
    type: "string",
    content: "string",
    from: "string",
    timestamp: "number",
};

function validType(val: unknown) {
    switch (val) {
        case "info":
        case "warning":
        case "error":
        case "task":
        case "stdout":
        case "stderr":
            return true;
    }
    return false;
}

export function badMessageType(x: never): never {
    throw new Error(`Invalid MessageType: ${x}`);
}

export function isMessage(val: unknown): val is Message {
    if (!hasValidProps(val, msgProps)) return false;
    return validType((val as any).type);
}

export function validateMessage(val: unknown) {
    validateProps("Message", val, msgProps);
    if (!validType((val as any).type)) {
        throw new ValidationError("Message", `invalid 'type' property value '${(val as any).type}'`);
    }
}

export interface MessageSummary {
    info: number;
    warning: number;
    error: number;
    task: number;
    stdout: number;
    stderr: number;
}

export interface MessageLogger {
    readonly messages: ReadonlyArray<Message>;
    readonly summary: MessageSummary;
    readonly from: string;
    info: Logger;
    warning: Logger;
    error: Logger;
    log: (type: MessageType, arg: any, ...args: any[]) => void;
    append: (this: MessageLogger, toAppend: Message[]) => void;
    message: (this: MessageLogger, msg: Message) => void;
    outStream?: stream.Writable;
    errStream?: stream.Writable;
    readonly isMessageLogger: true;
    createChild: (this: MessageLogger, id: string) => this;
}

export function isMessageLogger(val: unknown): val is MessageLogger {
    return (val && typeof val === "object" && (val as any).isMessageLogger === true);
}

export interface MessageStore {
    readonly messages: ReadonlyArray<Message>;
    store: (this: MessageStore, msg: Message) => void;
    readonly summary: MessageSummary;
}

export class LocalStore implements MessageStore {
    readonly messages: Message[] = [];
    readonly summary: MessageSummary = {
        info: 0,
        warning: 0,
        error: 0,
        task: 0,
        stdout: 0,
        stderr: 0,
    };
    store(msg: Message) {
        this.messages.push(msg);
        this.summary[msg.type]++;
    }
}

/**
 * MessageEmitter events are namespaced using EventEmitter2.
 * For message-related events, the first component is "message".
 * The remaining components are the task ID.
 *
 * To listen to messages from all tasks:
 *   taskEmitter.on(`message:**`, callback);
 * To listen to all messages for a specific task:
 *   taskEmitter.on(`message:${taskId}`, callback);
 */
export interface MessageEmitter extends EventEmitter2 {
    on(event: ee2.event | eventNS, listener: ListenerFn,
        options?: boolean | OnOptions): this | Listener;
    on(event: "close", listener: () => void): this | Listener;

    once(event: ee2.event | eventNS, listener: ListenerFn,
        options?: true | OnOptions): this | Listener;
    once(event: "close", listener: () => void): this | Listener;

    prependListener(event: ee2.event | eventNS, listener: ListenerFn,
        options?: boolean | OnOptions): this | Listener;
    prependListener(event: "close", listener: () => void): this | Listener;

    prependOnceListener(event: ee2.event | eventNS, listener: ListenerFn,
        options?: boolean | OnOptions): this | Listener;
    prependOnceListener(event: "close", listener: () => void): this | Listener;

    emit(event: string, msg: Message): boolean;
    listeners(event: string | string[]): MessageListener[];
}
export type MessageListener = (msg: Message) => void;

export enum TaskState {
    Created = "Created",
    Started = "Started",
    Complete = "Complete",
    Skipped = "Skipped",
    Failed = "Failed",
}

export enum TaskStatus {
    Description = "Description",
    Status = "Status",
    ChildGroup = "ChildGroup",
}

export type TaskEvent = TaskState | TaskStatus;
// tslint:disable-next-line:variable-name
export const TaskEvent = { ...TaskStatus, ...TaskState };

export function badTaskEvent(event: never): never {
    throw new Error(`Invalid TaskEvent ${event}`);
}

function isTaskEvent(event: unknown): event is TaskEvent {
    const ev = event as TaskEvent;
    switch (ev) {
        case TaskEvent.Created:
        case TaskEvent.Started:
        case TaskEvent.Complete:
        case TaskEvent.Skipped:
        case TaskEvent.Failed:
        case TaskEvent.Description:
        case TaskEvent.Status:
        case TaskEvent.ChildGroup:
            return true;
        default:
            return badTaskEvent(ev);
    }
}

/**
 * TaskEmitter events are namespaced using EventEmitter2.
 * For task-related events, the first component is "task". The second
 * component is the task event type (see TaskEvent).
 * The remaining components are the task ID.
 *
 * To listen to Created events for all tasks:
 *   taskEmitter.on(`task:Created:**`, callback);
 * To listen to all events for a specific task:
 *   taskEmitter.on(`task:*:${taskId}`, callback);
 * To listen to all events for all tasks:
 *   taskEmitter.on(`task:**`, callback);
 */
export interface TaskEmitter extends EventEmitter2 {
    on(event: ee2.event | eventNS, listener: ListenerFn,
        options?: boolean | OnOptions): this | Listener;
    on(event: "close", listener: () => void): this | Listener;

    once(event: ee2.event | eventNS, listener: ListenerFn,
        options?: true | OnOptions): this | Listener;
    once(event: "close", listener: () => void): this | Listener;

    prependListener(event: ee2.event | eventNS, listener: ListenerFn,
        options?: boolean | OnOptions): this | Listener;
    prependListener(event: "close", listener: () => void): this | Listener;

    prependOnceListener(event: ee2.event | eventNS, listener: ListenerFn,
        options?: boolean | OnOptions): this | Listener;
    prependOnceListener(event: "close", listener: () => void): this | Listener;

    emit(event: string, msg: Message): boolean;
    listeners(event: string | string[]): TaskListener[];
}
export type TaskListener =
    (event: TaskEvent, status: string | undefined, from: string) => void;

/**
 * Task message is one of these two forms:
 *   [Event]
 *   [Event]: Some status message
 */
const taskRegex = /^\[(.+?)\](?::\s*(.+))?$/m;

export function parseTaskContent(content: string) {
    const match = content.match(taskRegex);
    if (!match) throw new Error(`Task message not understood: ${content}`);

    const event = match[1];
    if (!isTaskEvent(event)) throw new Error(`Task event not understood: ${event}`);

    return {
        event,
        status: match[2],
    };
}

export interface MessageClient {
    info: MessageEmitter;
    warning: MessageEmitter;
    error: MessageEmitter;
    task: TaskEmitter;
    fromStream?: (this: MessageClient, inputStream: stream.Readable) => void;
    readonly isMessageClient: true;
    readonly outStream?: stream.Writable;
    readonly errStream?: stream.Writable;
}

export function isMessageClient(val: unknown): val is MessageClient {
    return (val && typeof val === "object" && (val as any).isMessageClient === true);
}
