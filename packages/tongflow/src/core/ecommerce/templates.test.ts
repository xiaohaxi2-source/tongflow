import type { Node } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import {
    NODE_TYPE_TO_ABI_FEATURE,
    resolvedSpecForNodeType,
} from "../abi/node-feature-registry";
import { buildPrompts, collectHandleValues } from "../abi/resolve";
import { MODALITY_NODE_TYPES } from "../constants/modality-nodes";
import { createFlowStore } from "../store/flow-store";
import { isValidFlowConnection } from "../workflow/connection-rules";
import { ECOM_FOLLOW_UP_TABLES, ECOM_KNOWN_GAPS } from "./prompt-presets";
import {
    applyEcommerceTemplate,
    type BuildEcommerceTemplateArgs,
    buildEcommerceTemplate,
} from "./templates";

function seq() {
    let n = 0;
    return () => `n${++n}`;
}

function build(args: BuildEcommerceTemplateArgs) {
    return buildEcommerceTemplate({
        ...args,
        createId: args.createId ?? seq(),
    });
}

function nodeOf(nodes: Node[], type: string): Node {
    const found = nodes.find((node) => node.type === type);
    if (!found) throw new Error(`missing ${type}`);
    return found;
}

function rolesInto(graph: ReturnType<typeof build>, targetType: string) {
    const target = nodeOf(graph.nodes, targetType);
    return graph.edges
        .filter(
            (edge) =>
                edge.target === target.id && edge.targetHandle === "in:images",
        )
        .map((edge) => {
            const source = graph.nodes.find((node) => node.id === edge.source);
            return (source?.data as { role?: string }).role;
        });
}

const REAL_TYPES = new Set<string>([
    ...Object.keys(NODE_TYPE_TO_ABI_FEATURE),
    ...MODALITY_NODE_TYPES,
    "addImageNode",
]);

function assertRealNodes(nodes: Node[]) {
    for (const node of nodes) {
        expect(REAL_TYPES.has(node.type ?? "")).toBe(true);
    }
}

function assertEdgesConnect(graph: ReturnType<typeof build>) {
    for (const edge of graph.edges) {
        expect(
            isValidFlowConnection(
                {
                    source: edge.source,
                    target: edge.target,
                    sourceHandle: edge.sourceHandle ?? null,
                    targetHandle: edge.targetHandle ?? null,
                },
                graph.nodes,
                graph.edges,
                edge.id,
            ),
        ).toBe(true);
    }
}

describe("ecommerce templates", () => {
    it("documents the three known gaps and the unmigrated tables", () => {
        expect(ECOM_KNOWN_GAPS.join(" ")).toMatch(/image-matting/);
        expect(ECOM_KNOWN_GAPS.join(" ")).toMatch(/two upstream/);
        expect(ECOM_KNOWN_GAPS.join(" ")).toMatch(/1024/);
        expect(ECOM_KNOWN_GAPS.join(" ")).toMatch(/800/);
        expect(ECOM_FOLLOW_UP_TABLES).toContain("products");
        expect(ECOM_FOLLOW_UP_TABLES).toContain("skus");
    });

    it("drops a product-clean graph with bilingual placeholders and ABI-safe prompts", () => {
        const graph = build({ templateId: "ecom.product.clean" });
        assertRealNodes(graph.nodes);
        assertEdgesConnect(graph);
        expect(
            graph.nodes.some((node) => node.type === "imageMattingNode"),
        ).toBe(false);
        expect(
            graph.nodes.some(
                (node) => node.type === "imageGenImageUpscaleNode",
            ),
        ).toBe(false);

        const edit = nodeOf(graph.nodes, "imageGenImageNode");
        const text = edit.data.text as string;
        expect(text).toContain("{{product_name}}");
        expect(text).toContain("纯白");
        expect(text).toContain("pure white");
        expect(edit.data.ecommerceTemplateId).toBe("ecom.product.clean");
        expect(edit.data.purpose).toBe("product");
        expect(edit.data.promptPresetId).toBe("preset.product.white_minimal");
        expect(edit.data.match_input_size).toBe(true);
        expect(edit.data.targetSize).toEqual({ w: 800, h: 800 });
        expect(edit.data.pluginId).toBeUndefined();

        const source = graph.nodes.find(
            (node) =>
                node.type === "imageNode" &&
                (node.data as { role?: string }).role === "product_source",
        );
        expect(source).toBeTruthy();
        source!.data = { ...source!.data, fileKeys: ["file-a"] };

        const spec = resolvedSpecForNodeType("imageGenImageNode");
        expect(spec).toBeTruthy();
        const prompts = buildPrompts({
            spec: spec!,
            configValues: {
                text: edit.data.text,
                match_input_size: edit.data.match_input_size,
            },
            handleValues: collectHandleValues(
                edit.id,
                spec!,
                graph.nodes,
                graph.edges,
            ),
        });
        expect(prompts).toHaveLength(1);
        const prompt = prompts[0];
        expect(prompt.text).toContain("{{product_name}}");
        expect(prompt.image).toBe("file-a");
        expect(prompt.match_input_size).toBe(true);
        expect(prompt).not.toHaveProperty("ecommerceTemplateId");
        expect(prompt).not.toHaveProperty("purpose");
        expect(prompt).not.toHaveProperty("promptPresetId");
        expect(prompt).not.toHaveProperty("targetSize");
        for (const key of Object.keys(prompt)) {
            expect(spec!.fields[key]).toBeTruthy();
        }

        const uploadEdge = graph.edges.find((edge) => {
            const sourceNode = graph.nodes.find(
                (node) => node.id === edge.source,
            );
            return sourceNode?.type === "addImageNode";
        });
        expect(uploadEdge?.sourceHandle).toBe("out:imageNode");
        expect(uploadEdge?.targetHandle).toBe("in:imageNode");
    });

    it("fills named slots and prefers an installed API plugin", () => {
        const graph = build({
            templateId: "ecom.product.clean",
            slots: { product_name: "陶瓷马克杯" },
            installedBySlot: {
                "image-edit": ["tongflow-modal-flux", "tongflow-api-gemini"],
            },
        });
        const edit = nodeOf(graph.nodes, "imageGenImageNode");
        expect(edit.data.text).toContain("陶瓷马克杯");
        expect(edit.data.text).not.toContain("{{product_name}}");
        expect(edit.data.text).toContain("{{category}}");
        expect(edit.data.pluginId).toBe("tongflow-api-gemini");
    });

    it("adds optional matting and upscale without replacing the edit path", () => {
        const graph = build({
            templateId: "ecom.product.clean",
            includeMatting: true,
            includeUpscale: true,
            installedBySlot: {
                "image-matting": ["tongflow-router-replicate"],
                "image-upscale": ["tongflow-router-fal"],
            },
        });
        expect(
            graph.nodes.some((node) => node.type === "imageGenImageNode"),
        ).toBe(true);
        const matting = nodeOf(graph.nodes, "imageMattingNode");
        expect(matting.data.pluginId).toBe("tongflow-router-replicate");
        const upscale = nodeOf(graph.nodes, "imageGenImageUpscaleNode");
        expect(upscale.data.resolution).toBe("2k");
        expect(upscale.data.pluginId).toBe("tongflow-router-fal");
        assertEdgesConnect(graph);
    });

    it("routes the cutout preset through matting before the white-bg edit", () => {
        const graph = build({
            templateId: "ecom.product.clean",
            presetId: "preset.product.cutout",
        });
        const edit = nodeOf(graph.nodes, "imageGenImageNode");
        expect(edit.data.text).toContain("纯白背景");
        expect(edit.data.text).toContain("anti-aliased");
        const editSources = graph.edges
            .filter(
                (edge) =>
                    edge.target === edit.id && edge.targetHandle === "in:image",
            )
            .map(
                (edge) =>
                    graph.nodes.find((node) => node.id === edge.source)?.type,
            );
        expect(editSources).toEqual(["imageNode"]);
        const cutout = graph.nodes.find(
            (node) => (node.data as { role?: string }).role === "cutout",
        );
        expect(cutout?.type).toBe("imageNode");
        expect(graph.edges.some((edge) => edge.target === cutout?.id)).toBe(
            true,
        );
        const matting = nodeOf(graph.nodes, "imageMattingNode");
        expect(
            graph.edges.some(
                (edge) =>
                    edge.source === matting.id && edge.target === cutout?.id,
            ),
        ).toBe(true);
    });

    it("builds a hero fusion graph and an image-edit fallback for one reference", () => {
        const fusion = build({ templateId: "ecom.main.hero" });
        assertRealNodes(fusion.nodes);
        assertEdgesConnect(fusion);
        expect(
            fusion.nodes.some((node) => node.type === "imageFusionNode"),
        ).toBe(true);
        expect(
            fusion.nodes.some((node) => node.type === "imageGenImageNode"),
        ).toBe(false);
        expect(rolesInto(fusion, "imageFusionNode")).toEqual([
            "product_ref",
            "product_ref_detail",
        ]);
        const fusionNode = nodeOf(fusion.nodes, "imageFusionNode");
        expect(fusionNode.data.width).toBe(1024);
        expect(fusionNode.data.height).toBe(1024);
        expect(fusionNode.data.targetSize).toEqual({ w: 800, h: 800 });
        expect(fusionNode.data.purpose).toBe("main");
        expect(fusionNode.data.text).toContain("{{selling_points}}");
        expect(fusionNode.data.text).toContain("Image1");

        const edit = build({ templateId: "ecom.main.hero", heroPath: "edit" });
        expect(edit.nodes.some((node) => node.type === "imageFusionNode")).toBe(
            false,
        );
        expect(
            edit.nodes.some((node) => node.type === "imageGenImageNode"),
        ).toBe(true);
        expect(
            edit.nodes.filter((node) => node.type === "imageNode"),
        ).toHaveLength(2);

        const draft = build({
            templateId: "ecom.main.hero",
            heroPath: "text-gen",
        });
        const gen = nodeOf(draft.nodes, "textGenImageNode");
        expect(gen.data.texts).toEqual([gen.data.text]);
        expect(draft.nodes.some((node) => node.type === "addImageNode")).toBe(
            false,
        );
        assertEdgesConnect(draft);
    });

    it("orders scene references product → scene → style and keeps both template ids", () => {
        const graph = build({ templateId: "ecom.scene.context" });
        expect(graph.templateId).toBe("ecom.scene.lifestyle");
        assertRealNodes(graph.nodes);
        assertEdgesConnect(graph);
        expect(rolesInto(graph, "imageFusionNode")).toEqual([
            "product_ref",
            "scene_ref",
            "style_ref",
        ]);
        const fusion = nodeOf(graph.nodes, "imageFusionNode");
        expect(fusion.data.ecommerceTemplateId).toBe("ecom.scene.lifestyle");
        expect(fusion.data.purpose).toBe("scene");
        expect(fusion.data.promptPresetId).toBe("preset.scene.lifestyle");
        expect(fusion.data.width).toBe(1280);
        expect(fusion.data.height).toBe(720);
        expect(fusion.data.text).toContain("Image3");
        expect(fusion.data.text).toContain("{{scene_desc}}");
        const baseline = fusion.data.seriesBaseline as {
            templateId: string;
            roleOrder: string[];
        };
        expect(baseline.templateId).toBe("ecom.scene.lifestyle");
        expect(baseline.roleOrder).toEqual([
            "product_ref",
            "scene_ref",
            "style_ref",
        ]);

        const noStyle = build({
            templateId: "ecom.scene.lifestyle",
            includeStyleRef: false,
        });
        expect(rolesInto(noStyle, "imageFusionNode")).toEqual([
            "product_ref",
            "scene_ref",
        ]);
        const text = nodeOf(noStyle.nodes, "imageFusionNode").data
            .text as string;
        expect(text).not.toContain("Image3");
    });

    it("appends onto an existing canvas and undo restores it", () => {
        const store = createFlowStore({
            initial: {
                nodes: [
                    {
                        id: "video-1",
                        type: "textGenVideoNode",
                        position: { x: 0, y: 0 },
                        origin: [0.5, 0.5],
                        data: { feature: "text-gen-video" },
                    },
                ],
                edges: [],
            },
        });
        const created: string[][] = [];
        store.getState().onNodeCreated((ids) => created.push(ids));
        const graph = applyEcommerceTemplate(store, {
            templateId: "ecom.main.hero",
            heroPath: "edit",
            createId: seq(),
        });
        const types = store.getState().nodes.map((node) => node.type);
        expect(types).toContain("textGenVideoNode");
        expect(types).toContain("imageGenImageNode");
        expect(store.getState().edges.length).toBe(graph.edges.length);
        expect(created).toEqual([graph.nodes.map((node) => node.id)]);

        store.getState().undo();
        expect(store.getState().nodes.map((node) => node.id)).toEqual([
            "video-1",
        ]);
        expect(store.getState().edges).toEqual([]);
    });
});
