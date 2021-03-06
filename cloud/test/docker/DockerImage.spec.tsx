/*
 * Copyright 2019 Unbounded Systems, LLC
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

import Adapt, {
    findElementsInDom,
    handle,
    PrimitiveComponent,
    rule,
    Sequence,
    Style,
    useImperativeMethods,
    useMethod,
} from "@adpt/core";
import should from "should";
import { LocalContainer } from "../../src";
import { DockerImage, DockerImageInstance, LocalDockerImage, LocalDockerImageProps } from "../../src/docker";
import { doBuild } from "../testlib";

class MockDockerImage extends PrimitiveComponent<LocalDockerImageProps>
    implements DockerImageInstance {

    image() {
        return {
            id: "imageid",
            nameTag: "imagetag"
        };
    }
    latestImage() {
        return {
            id: "latestid",
            nameTag: "latesttag"
        };
    }
}

function MockService() {
    const img = handle<DockerImageInstance>();
    const latest = useMethod(img, "latestImage");
    const image = useMethod(img, "image");

    useImperativeMethods(() => ({ image, latest }));

    return (
        <Sequence>
            <DockerImage handle={img} />
            {latest && latest.nameTag ?
                <LocalContainer name="myservice" image={latest.nameTag} dockerHost="" /> : null
            }
        </Sequence>
    );
}

const mockImageStyle =
    <Style>
        {DockerImage} {rule(() => <MockDockerImage />)}
        {LocalDockerImage} {rule(() => <MockDockerImage />)}
    </Style>;

const findLocalContainers =
    <Style>
        {LocalContainer} {rule()}
    </Style>;

describe("DockerImage", () => {
    it("Should replace with non-abstract image", async () => {
        const h = handle();
        const orig = <MockService handle={h} />;

        const { dom } = await doBuild(orig, { style: mockImageStyle });
        const els = findElementsInDom(findLocalContainers, dom);
        should(els).have.length(1);
        should(els[0].props.image).equal("latesttag");
        const inst = h.mountedOrig && h.mountedOrig.instance;
        if (!inst) throw should(inst).be.ok();
        should(inst.image).eql({ id: "imageid", nameTag: "imagetag" });
        should(inst.latest).eql({ id: "latestid", nameTag: "latesttag" });
    });
});
