import Adapt, { rule, Style } from "@usys/adapt";
import {
    Compute,
    ComputeProps,
    Container,
    ContainerProps,
    DockerHost,
    DockerHostProps,
    LocalCompute,
    NetworkService,
    NetworkServiceProps,
} from "@usys/cloud";
// tslint:disable:no-submodule-imports
import { AnsibleContainer, AnsibleDockerHost } from "@usys/cloud/ansible";

export const localStyle =
    <Style>
        {Compute} {rule<ComputeProps>(({handle, ...props}) => {
            return <LocalCompute {...props}/>;
        })}

        {DockerHost} {rule<DockerHostProps>(({handle, ...props}, info) => {
            return <AnsibleDockerHost ansibleHost={{
                ansible_connection: "local"
            }} {...props} />;
        })}

        {Container} {rule<ContainerProps>(({handle, ...props}) => {
            return <AnsibleContainer {...props} dockerHost="unix:///var/run/docker.sock" />;
        })}

        {NetworkService} {rule<NetworkServiceProps>((props) => (
            null
        ))}
    </Style>;
export default localStyle;
