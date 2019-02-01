import { formatUserError } from "@usys/utils";
import { ProjectRunError } from "../error";
import { adaptServer, AdaptServer } from "../server";
import {
    createDeployment as createDeploymentObj,
    Deployment,
    destroyDeployment
} from "../server/deployment";
import { buildAndDeploy } from "./buildAndDeploy";
import {
    defaultDeployCommonOptions,
    DeployCommonOptions,
    DeployState,
    withOpsSetup,
} from "./common";
import { forkExports } from "./fork";

export interface CreateOptions extends DeployCommonOptions {
    projectName: string;

    initLocalServer?: boolean;
    initialStateJson?: string;
    initialObservationsJson?: string;
}

const defaultOptions = {
    initLocalServer: false,
    initialStateJson: "{}",
    initialObservationsJson: "{}"
};

export async function createDeployment(options: CreateOptions): Promise<DeployState> {
    const finalOptions = {
        ...defaultDeployCommonOptions,
        ...defaultOptions,
        ...options
    };

    const {
        adaptUrl,
        client,
        initLocalServer,
        initialStateJson,
        initialObservationsJson,
        logger: _logger,
        loggerId,
        projectName,
        ...buildOpts
    } = finalOptions;

    const setup = {
        name: "createDeployment",
        description: "Creating deployment",
        client,
        logger: _logger,
        loggerId,
    };
    return withOpsSetup(setup, async (info): Promise<DeployState> => {
        const { logger, taskObserver } = info;
        let ds: DeployState;
        let server: AdaptServer | null = null;
        let deployment: Deployment | null = null;
        try {
            server = await adaptServer(adaptUrl, {
                init: finalOptions.initLocalServer,
            });
            deployment = await createDeploymentObj(server, projectName,
                finalOptions.stackName);
            ds = await buildAndDeploy({
                deployment,
                prevStateJson: initialStateJson,
                observationsJson: initialObservationsJson,
                taskObserver,
                ...buildOpts
            });

        } catch (err) {
            const message = err instanceof ProjectRunError ?
                `${err.message}:\n${err.projectStack}` :
                formatUserError(err);
            logger.error(`Error creating deployment: ${message}`);
            ds = {
                type: "error",
                messages: logger.messages,
                summary: logger.summary,
                domXml: err.domXml,
            };
        }

        if (server && deployment && (finalOptions.dryRun || ds.type === "error")) {
            try {
                await destroyDeployment(server, deployment.deployID);
            } catch (err) {
                logger.warning(`Error destroying deployment: ${err}`);
            }
        }
        return ds;
    });
}

forkExports(module, "createDeployment");
