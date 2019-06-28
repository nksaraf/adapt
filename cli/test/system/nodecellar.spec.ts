import {
    awsutils,
    describeLong,
    dockerutils,
    k8sutils,
    mochaTmpdir,
} from "@adpt/testutils";
import { sleep } from "@adpt/utils";
import Docker = require("dockerode");
import execa from "execa";
import * as fs from "fs-extra";
import * as path from "path";
import { expect } from "../common/fancy";
import { findDeploymentDir, findHistoryDirs } from "../common/local_server";
import { mkInstance } from "../common/start-minikube";
import { curlOptions, projectsRoot, systemTestChain } from "./common";

const { deleteAll, getAll } = k8sutils;
const {
    checkStackStatus,
    deleteAllStacks,
    getAwsClient,
    waitForStacks,
} = awsutils;
const { deleteContainer } = dockerutils;

// FIXME(mark): The following line needs to be a require because importing
// the types from adapt currently causes a compile error due to adapt
// not having strictFunctionTypes=true
// FIXME(mark): The following line does a deep submodule import to avoid
// triggering the AWS plugin to register. The modules should probably be
// reorganized to better allow this import.
// tslint:disable-next-line:no-submodule-imports no-var-requires
const awsCredentials = require("@adpt/cloud/dist/src/aws/credentials");
const { loadAwsCreds } = awsCredentials;

const newDeployRegex = /Deployment created successfully. DeployID is: (.*)$/m;

// NOTE(mark): These tests use the same project directory to deploy multiple
// times, both to test that functionality and to reduce setup runtime (mostly
// from NPM).
describeLong("Nodecellar system tests", function () {
    const docker = new Docker({ socketPath: "/var/run/docker.sock" });
    let kClient: k8sutils.KubeClient;
    let aClient: AWS.CloudFormation;
    let lDeployID: string | undefined;
    let kDeployID: string | undefined;
    let aDeployID: string | undefined;

    this.timeout(6 * 60 * 1000);

    const copyDir = path.join(projectsRoot, "nodecellar");
    mochaTmpdir.all("adapt-cli-test-nodecellar", { copy: copyDir });

    before(async function () {
        this.timeout(60 * 1000 + mkInstance.setupTimeoutMs);
        const results = await Promise.all([
            mkInstance.client,
            loadAwsCreds(),
            deleteContainer(docker, "mongo"),
            deleteContainer(docker, "nodecellar"),
            fs.outputJson("kubeconfig.json", await mkInstance.kubeconfig),
        ]);

        kClient = results[0];
        aClient = getAwsClient(results[1]);
    });

    after(async function () {
        this.timeout(30 * 1000);
        await Promise.all([
            deleteContainer(docker, "mongo"),
            deleteContainer(docker, "nodecellar"),
        ]);
    });

    afterEach(async function () {
        this.timeout(65 * 1000);
        if (kDeployID && kClient) {
            await Promise.all([
                deleteAll("pods", { client: kClient, deployID: kDeployID }),
                deleteAll("services", { client: kClient, deployID: kDeployID }),
            ]);
            kDeployID = undefined;
        }
        if (aDeployID && aClient) {
            await deleteAllStacks(aClient, aDeployID, 60 * 1000, false);
            aDeployID = undefined;
        }
    });

    systemTestChain
    .command(["run", "dev"])

    .it("Should deploy local style", async (ctx) => {
        expect(ctx.stderr).equals("");
        expect(ctx.stdout).contains("Validating project [completed]");
        expect(ctx.stdout).contains("Creating new project deployment [completed]");

        // TODO(mark): This test currently currently generates a warning
        // for the implicit playbook Element from the Ansible plugin not
        // being found in the DOMs. Uncomment this when fixed.
        //expect(ctx.stdout).does.not.contain("WARNING");

        const matches = ctx.stdout.match(newDeployRegex);
        expect(matches).to.be.an("array").with.length(2);
        if (matches && matches[1]) lDeployID = matches[1];
        expect(lDeployID).to.be.a("string").with.length.greaterThan(0);

        const nc = docker.getContainer("nodecellar");
        const ncIP = (await nc.inspect()).NetworkSettings.IPAddress;

        let ret = await execa("curl", [
            ...curlOptions,
            `http://${ncIP}:8080/`
        ]);
        expect(ret.stdout).contains("<title>Node Cellar</title>");

        ret = await execa("curl", [
            ...curlOptions,
            `http://${ncIP}:8080/wines`
        ]);
        expect(ret.stdout).contains("Though dense and chewy, this wine does not overpower");
    });

    systemTestChain
    .command(["run", "k8s"])

    .it("Should deploy k8s style", async (ctx) => {
        expect(ctx.stderr).equals("");
        expect(ctx.stdout).contains("Validating project [completed]");
        expect(ctx.stdout).contains("Creating new project deployment [completed]");
        expect(ctx.stdout).does.not.contain("WARNING");

        const matches = ctx.stdout.match(newDeployRegex);
        expect(matches).to.be.an("array").with.length(2);
        if (matches && matches[1]) kDeployID = matches[1];
        expect(kDeployID).to.be.a("string").with.length.greaterThan(0);

        let pods: any;
        let i: number;
        for (i = 120; i > 0; i--) {
            pods = await getAll("pods", { client: kClient, deployID: kDeployID });
            expect(pods).to.have.length(1);
            expect(pods[0] && pods[0].status).to.be.an("object").and.not.null;

            // containerStatuses can take a moment to populate
            if (pods[0].status.containerStatuses) {
                expect(pods[0].status.containerStatuses).to.be.an("array").with.length(2);
                if ((pods[0].status.phase === "Running") &&
                    (pods[0].status.containerStatuses[0].ready) &&
                    (pods[0].status.containerStatuses[1].ready)) {
                    break;
                }
            }
            await sleep(1000);
        }
        if (i <= 0) throw new Error(`Pods did not become ready`);
        expect(pods[0].spec.containers).to.have.length(2);

        // TODO: Should be able to curl the web interface and get HTML
    });

    function getStackName(stateStore: any): string {
        if (typeof stateStore !== "object") throw new Error(`Bad state`);
        for (const ns of Object.keys(stateStore)) {
            const state = stateStore[ns];
            const ids = state.adaptResourceIds;
            if (!ids) continue;
            const sn = ids.StackName;
            if (!sn) continue;
            const id = sn.currentId;
            if (id) return id;
        }
        throw new Error(`Unable to find StackName in state store`);
    }

    systemTestChain
    .command(["run", "aws"])

    .it("Should deploy AWS style", async (ctx) => {
        expect(ctx.stderr).equals("");
        expect(ctx.stdout).contains("Validating project [completed]");
        expect(ctx.stdout).contains("Creating new project deployment [completed]");
        // TODO(mark): This test currently currently generates a warning
        // for the LocalContainer and LocalDockerHost elements not being
        // claimed by plugins. Uncomment this when fixed.
        //expect(ctx.stdout).does.not.contain("WARNING");

        const matches = ctx.stdout.match(newDeployRegex);
        expect(matches).to.be.an("array").with.length(2);
        if (matches && matches[1]) aDeployID = matches[1];
        else throw new Error(`No DeployID found in CLI output`);
        expect(aDeployID).to.be.a("string").with.length.greaterThan(0);

        // FIXME(mark): I need the generated StackName here to check if
        // things actually deployed, but we don't have status working yet,
        // so rummage around in the deployment history to get it. Yuck.
        const deployDir = findDeploymentDir(aDeployID);
        const historyDirs = await findHistoryDirs(deployDir);
        expect(historyDirs).to.have.length(2);
        const store = await fs.readJson(path.join(historyDirs[0], "adapt_state.json"));
        const stackName = getStackName(store);

        const stacks = await waitForStacks(aClient, aDeployID, [stackName],
            {timeoutMs: 4 * 60 * 1000});
        expect(stacks).to.have.length(1, "wrong number of stacks");
        await checkStackStatus(stacks[0], "CREATE_COMPLETE", true, aClient);

        // TODO: Should be able to curl the web interface and get HTML
    });
});
