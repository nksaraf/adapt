import { createMockLogger } from "@usys/testutils";
import { createTaskObserver } from "@usys/utils";
import fs from "fs-extra";
import * as path from "path";
import { PluginModule } from "../../src/deploy";
import { createPluginManager } from "../../src/deploy/plugin_support";
import { AdaptElement, FinalDomElement } from "../../src/jsx";
import { Deployment } from "../../src/server/deployment";
import { createStateStore, StateStore } from "../../src/state";
import { doBuild } from "./do_build";
import { createMockDeployment } from "./server_mocks";

export interface MockDeployOptions {
    pluginCreates: PluginModule["create"][];
    tmpDir: string;
    prevDom?: FinalDomElement;
}

export interface DeployOptions {
    dryRun?: boolean;
}

const defaultDeployOptions = {
    dryRun: false,
};

export interface DeployOutput {
    dom: FinalDomElement | null;
}

export class MockDeploy {
    prevDom: FinalDomElement | null = null;
    currDom: FinalDomElement | null = null;
    logger = createMockLogger();
    dataDir: string;
    deployID = "MockDeploy123";
    deployment_?: Deployment;
    plugins = new Map<string, PluginModule>();
    // NOTE: Adding type "StateStore" here may seem redundant, but if it's
    // not explicit, the generated .d.ts file contains an import of @usys/adapt
    // that causes builds in the cloud directory to try to add all of
    // adapt's SOURCE FILES to the cloud build...which creates huge compile
    // errors in cloud.
    stateStore: StateStore = createStateStore("{}");

    constructor(options: MockDeployOptions) {
        if (options.pluginCreates.length === 0) throw new Error(`Must specify plugins`);
        options.pluginCreates.forEach((create) => {
            const inst = create();
            const name = inst.constructor.name;
            this.plugins.set(name, {
                name,
                module,
                create,
                packageName: name,
                version: "0.0.1",
            });
        });
        if (options.prevDom) this.prevDom = options.prevDom;
        this.dataDir = path.join(options.tmpDir, "pluginData");
    }

    async init() {
        this.deployment_ = await createMockDeployment({ deployID: this.deployID });
        await fs.ensureDir(this.dataDir);
    }

    get deployment() {
        if (!this.deployment_) throw new Error(`deployment == null. init not called?`);
        return this.deployment_;
    }

    async deploy(orig: AdaptElement | null, options: DeployOptions = {}): Promise<DeployOutput> {
        const opts = { ...defaultDeployOptions, ...options };
        let dom: FinalDomElement | null;
        const taskObserver = createTaskObserver("parent", { logger: this.logger });
        taskObserver.started();
        const mgr = createPluginManager(this.plugins);
        const mgrOpts = {
            logger: this.logger,
            deployment: this.deployment,
            dataDir: this.dataDir,
        };
        const actOpts = {
            dryRun: opts.dryRun,
            sequence: await this.deployment.newSequence(),
            taskObserver,
        };

        if (orig === null) {
            dom = orig;
        } else {
            const res = await doBuild(orig, {
                deployID: this.deployID,
                stateStore: this.stateStore,
            });
            dom = res.dom;
        }
        this.currDom = dom;

        await mgr.start(this.prevDom, dom, mgrOpts);
        await mgr.observe();
        mgr.analyze();
        await mgr.act(actOpts);
        await mgr.finish();

        this.prevDom = dom;

        return { dom };
    }
}
