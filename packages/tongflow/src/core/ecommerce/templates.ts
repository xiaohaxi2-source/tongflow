/**
 * Ecommerce quick-template graphs.
 *
 * Drops real React Flow node types already registered in tongflow
 * (`addImageNode`, `imageNode`, `textNode`, `imageGenImageNode`,
 * `imageFusionNode`, `imageMattingNode`, `imageGenImageUpscaleNode`,
 * `textGenImageNode`). Optional ecommerce metadata sits beside ABI fields
 * and is not part of the slot prompt.
 *
 * An `addImageNode` is wired to exactly one downstream `imageNode`. Uploading
 * there reuses that child (`expands` merges `fileKeys`), so the rest of the
 * graph stays connected.
 *
 * Known gaps (see `ECOM_KNOWN_GAPS`): matting plugin coverage, fusion's
 * two-image minimum, and 1024 vs the 800×800 delivery target.
 */

import type { Edge, Node } from "@xyflow/react";
import {
    resolvedSpecForNodeType,
    resolveEdgeHandles,
} from "../abi/node-feature-registry";
import type { FlowCoreState } from "../store/flow-store";
import { estimateNodeSize, H_GAP, V_GAP } from "../workflow/layout/node-dims";
import {
    canonicalTemplateId,
    composeBilingualPrompt,
    type EcommerceTemplateId,
    presetById,
    renderPromptBody,
} from "./prompt-presets";

export type HeroPath = "fusion" | "edit" | "text-gen";

export interface BuildEcommerceTemplateArgs {
    templateId: string;
    presetId?: string;
    /** Non-empty values replace `{{slot}}` markers. Empty values leave them. */
    slots?: Record<string, string | undefined>;
    /** Which language leads the bilingual prompt written to `text` / `texts`. */
    lead?: "zh" | "en";
    /** Hero only. `fusion` needs two reference images; `edit` is the one-image path. */
    heroPath?: HeroPath;
    /** Product clean: also drop `imageMattingNode`. Forced on for the cutout preset. */
    includeMatting?: boolean;
    /** Product clean: also drop `imageGenImageUpscaleNode` after the result. */
    includeUpscale?: boolean;
    /** Scene: include the optional style reference (Image3 / style_ref). */
    includeStyleRef?: boolean;
    /** Scene: image-edit polish after the fusion result. */
    includePolish?: boolean;
    /**
     * Installed plugin ids per ABI slot (`nodePluginMap`). When an API-first
     * id is present it is written to `pluginId`. Otherwise `pluginId` is left
     * unset so the node resolver picks the installed default.
     */
    installedBySlot?: Record<string, readonly string[] | undefined>;
    existingNodes?: Node[];
    createId?: () => string;
}

export interface EcommerceGraph {
    templateId: EcommerceTemplateId;
    nodes: Node[];
    edges: Edge[];
}

/** Minimal store surface `applyEcommerceTemplate` writes through. */
export interface EcommerceFlowApi {
    getState(): Pick<
        FlowCoreState,
        | "nodes"
        | "edges"
        | "commitHistory"
        | "setNodes"
        | "setEdges"
        | "nodeCreatedCallbacks"
    >;
}

const API_FIRST = [
    "tongflow-api-openai",
    "tongflow-api-bytedance",
    "tongflow-api-gemini",
    "tongflow-router-openrouter",
    "tongflow-router-cometapi",
] as const;

const MATTING_FIRST = [
    "tongflow-router-fal",
    "tongflow-router-replicate",
] as const;

const SQUARE_OUTPUT = { width: 1024, height: 1024 };
const SQUARE_TARGET = { w: 800, h: 800 };
const SCENE_OUTPUT = { width: 1280, height: 720 };

const POLISH_ZH = `在保持「{{product_name}}」外形、颜色与品牌标识不变的前提下，清理场景图杂物、水印和不合理阴影，光线更自然。`;
const POLISH_EN = `Keep "{{product_name}}" shape, color, and branding. Remove clutter, watermarks, and broken shadows; make the light more natural.`;

interface DraftNode {
    key: string;
    type: string;
    data: Record<string, unknown>;
    col: number;
    row: number;
}

interface DraftEdge {
    source: string;
    target: string;
}

/**
 * Pick an installed plugin for a slot, preferring API / router plugins.
 * Returns undefined when none of the preferred ids are installed.
 */
export function preferredPluginId(
    slot: string,
    installed: readonly string[] | undefined,
): string | undefined {
    const have = new Set(installed ?? []);
    const order =
        slot === "image-matting" || slot === "image-upscale"
            ? [...MATTING_FIRST, ...API_FIRST]
            : API_FIRST;
    return order.find((id) => have.has(id));
}

function defaultCreateId(): string {
    return globalThis.crypto.randomUUID();
}

function tag(
    templateId: EcommerceTemplateId,
    purpose: string,
    extra: Record<string, unknown>,
): Record<string, unknown> {
    return {
        ecommerceTemplateId: templateId,
        purpose,
        ...extra,
    };
}

class GraphBuilder {
    readonly nodes: DraftNode[] = [];
    readonly edges: DraftEdge[] = [];

    add(
        key: string,
        type: string,
        data: Record<string, unknown>,
        col: number,
        row: number,
    ): string {
        this.nodes.push({ key, type, data, col, row });
        return key;
    }

    link(source: string, target: string): void {
        this.edges.push({ source, target });
    }
}

function anchor(existing: Node[]): { x: number; y: number } {
    if (existing.length === 0) return { x: 160, y: 280 };
    let right = -Infinity;
    let y = 280;
    for (const node of existing) {
        const size = estimateNodeSize(node);
        const edge = node.position.x + size.w / 2;
        if (edge > right) {
            right = edge;
            y = node.position.y;
        }
    }
    return { x: right + H_GAP, y };
}

function layout(
    drafts: DraftNode[],
    origin: { x: number; y: number },
): Map<string, { x: number; y: number }> {
    const cols = [...new Set(drafts.map((d) => d.col))].sort((a, b) => a - b);
    const rows = [...new Set(drafts.map((d) => d.row))].sort((a, b) => a - b);
    const colWidth = new Map<number, number>();
    const rowHeight = new Map<number, number>();
    for (const draft of drafts) {
        const size = estimateNodeSize({ type: draft.type });
        colWidth.set(draft.col, Math.max(colWidth.get(draft.col) ?? 0, size.w));
        rowHeight.set(
            draft.row,
            Math.max(rowHeight.get(draft.row) ?? 0, size.h),
        );
    }

    const colX = new Map<number, number>();
    let left = origin.x;
    for (const col of cols) {
        const width = colWidth.get(col) ?? 0;
        colX.set(col, left + width / 2);
        left += width + H_GAP;
    }

    const rowY = new Map<number, number>();
    const firstRow = rows[0] ?? 0;
    let top = origin.y - (rowHeight.get(firstRow) ?? 0) / 2;
    for (const row of rows) {
        const height = rowHeight.get(row) ?? 0;
        rowY.set(row, top + height / 2);
        top += height + V_GAP;
    }

    const positions = new Map<string, { x: number; y: number }>();
    for (const draft of drafts) {
        positions.set(draft.key, {
            x: colX.get(draft.col) ?? origin.x,
            y: rowY.get(draft.row) ?? origin.y,
        });
    }
    return positions;
}

function materialize(
    builder: GraphBuilder,
    existing: Node[],
    createId: () => string,
): { nodes: Node[]; edges: Edge[] } {
    const positions = layout(builder.nodes, anchor(existing));
    const ids = new Map<string, string>();
    const nodes: Node[] = builder.nodes.map((draft) => {
        const id = createId();
        ids.set(draft.key, id);
        return {
            id,
            type: draft.type,
            position: positions.get(draft.key) ?? { x: 0, y: 0 },
            origin: [0.5, 0.5],
            data: draft.data,
        };
    });
    const byKey = new Map(builder.nodes.map((draft) => [draft.key, draft]));
    const edges: Edge[] = builder.edges.map((draft) => {
        const source = byKey.get(draft.source);
        const target = byKey.get(draft.target);
        const resolved = resolveEdgeHandles({
            sourceType: source?.type,
            targetType: target?.type,
            targetSpec: resolvedSpecForNodeType(target?.type),
        });
        const sourceHandle =
            resolved.sourceHandle ??
            (source?.type === "addImageNode" ? "out:imageNode" : undefined);
        return {
            id: createId(),
            source: ids.get(draft.source) ?? draft.source,
            target: ids.get(draft.target) ?? draft.target,
            type: "custom-edge",
            ...(sourceHandle ? { sourceHandle } : {}),
            ...(resolved.targetHandle
                ? { targetHandle: resolved.targetHandle }
                : {}),
        };
    });
    return { nodes, edges };
}

function promptFor(
    templateId: EcommerceTemplateId,
    presetId: string | undefined,
    slots: Record<string, string | undefined>,
    lead: "zh" | "en",
    blocks: Record<string, boolean>,
): { presetId: string; text: string } {
    const preset = presetById(templateId, presetId);
    return {
        presetId: preset.id,
        text: composeBilingualPrompt(
            renderPromptBody(preset.zh, slots, blocks),
            renderPromptBody(preset.en, slots, blocks),
            lead,
        ),
    };
}

function execData(args: {
    feature: string;
    templateId: EcommerceTemplateId;
    purpose: string;
    presetId: string;
    text: string;
    installedBySlot?: BuildEcommerceTemplateArgs["installedBySlot"];
    extra?: Record<string, unknown>;
}): Record<string, unknown> {
    const pluginId = preferredPluginId(
        args.feature,
        args.installedBySlot?.[args.feature],
    );
    return tag(args.templateId, args.purpose, {
        feature: args.feature,
        promptPresetId: args.presetId,
        text: args.text,
        ...(pluginId ? { pluginId } : {}),
        ...args.extra,
    });
}

function textData(
    templateId: EcommerceTemplateId,
    purpose: string,
    presetId: string,
    text: string,
    label: string,
): Record<string, unknown> {
    return tag(templateId, purpose, {
        texts: [text],
        promptPresetId: presetId,
        role: "prompt",
        label,
        comment: "执行提示词（中英）。未填写的 {{槽位}} 会原样保留。",
    });
}

function uploadData(
    templateId: EcommerceTemplateId,
    purpose: string,
    label: string,
    comment: string,
): Record<string, unknown> {
    return tag(templateId, purpose, {
        activeTab: "upload",
        role: "upload",
        label,
        comment,
    });
}

function imageData(
    templateId: EcommerceTemplateId,
    purpose: string,
    role: string,
    label: string,
    comment: string,
    extra: Record<string, unknown> = {},
): Record<string, unknown> {
    return tag(templateId, purpose, {
        role,
        label,
        comment,
        ...extra,
    });
}

function buildProduct(
    args: BuildEcommerceTemplateArgs,
    templateId: EcommerceTemplateId,
): GraphBuilder {
    const slots = args.slots ?? {};
    const lead = args.lead ?? "zh";
    const { presetId, text } = promptFor(
        templateId,
        args.presetId,
        slots,
        lead,
        {},
    );
    const cutout = presetId === "preset.product.cutout";
    const matting = cutout || args.includeMatting === true;
    const graph = new GraphBuilder();
    const installed = args.installedBySlot;

    graph.add(
        "upload",
        "addImageNode",
        uploadData(
            templateId,
            "product",
            "上传商品照",
            "上传后图片写入右侧已连接的源商品图。",
        ),
        0,
        0,
    );
    graph.add(
        "source",
        "imageNode",
        imageData(
            templateId,
            "product",
            "product_source",
            "源商品图",
            "role=product_source。用左侧上传节点放入商品照。",
        ),
        1,
        0,
    );
    graph.link("upload", "source");

    if (cutout) {
        graph.add(
            "matting",
            "imageMattingNode",
            execData({
                feature: "image-matting",
                templateId,
                purpose: "product",
                presetId,
                text: "",
                installedBySlot: installed,
                extra: {
                    comment:
                        "可选抠图。tongflow-api-* 未声明 image-matting；需要 fal / replicate 或 Modal 抠图插件。",
                },
            }),
            2,
            0,
        );
        graph.add(
            "cutout",
            "imageNode",
            imageData(
                templateId,
                "product",
                "cutout",
                "透明抠图",
                "image-matting 结果。未安装抠图插件时此节点不会有图，请改用极简白底预设。",
            ),
            3,
            0,
        );
        graph.link("source", "matting");
        graph.link("matting", "cutout");
        graph.add(
            "edit",
            "imageGenImageNode",
            execData({
                feature: "image-edit",
                templateId,
                purpose: "product",
                presetId,
                text,
                installedBySlot: installed,
                extra: {
                    match_input_size: true,
                    targetSize: SQUARE_TARGET,
                    comment:
                        "把抠图铺到白底。match_input_size 保持像素。targetSize 800×800 只是交付目标，没有 sharp 节点。",
                },
            }),
            4,
            0,
        );
        graph.add(
            "prompt",
            "textNode",
            textData(templateId, "product", presetId, text, "白底提示词"),
            4,
            1,
        );
        graph.link("cutout", "edit");
        graph.link("prompt", "edit");
    } else {
        graph.add(
            "prompt",
            "textNode",
            textData(templateId, "product", presetId, text, "清理提示词"),
            2,
            0,
        );
        graph.add(
            "edit",
            "imageGenImageNode",
            execData({
                feature: "image-edit",
                templateId,
                purpose: "product",
                presetId,
                text,
                installedBySlot: installed,
                extra: {
                    match_input_size: true,
                    targetSize: SQUARE_TARGET,
                    comment:
                        "image-edit 白底清理（无抠图插件也可跑）。match_input_size 保持源图像素。targetSize 800×800 仅为交付目标。",
                },
            }),
            3,
            0,
        );
        graph.link("source", "edit");
        graph.link("prompt", "edit");
        if (matting) {
            graph.add(
                "matting",
                "imageMattingNode",
                execData({
                    feature: "image-matting",
                    templateId,
                    purpose: "product",
                    presetId,
                    text: "",
                    installedBySlot: installed,
                    extra: {
                        comment:
                            "可选抠图分支。API 插件通常没有 image-matting；未安装时主路径仍是图编辑。",
                    },
                }),
                2,
                1,
            );
            graph.add(
                "cutout",
                "imageNode",
                imageData(
                    templateId,
                    "product",
                    "cutout",
                    "透明抠图",
                    "可选 image-matting 结果。",
                    { promptPresetId: presetId },
                ),
                3,
                1,
            );
            graph.link("source", "matting");
            graph.link("matting", "cutout");
        }
    }

    graph.add(
        "result",
        "imageNode",
        imageData(
            templateId,
            "product",
            "result",
            "商品图结果",
            "purpose=product。导出命名建议 {{skuCode}}_product_800x800_v{{version}}.png。精确 800 留给后续 sharp。",
            { promptPresetId: presetId, targetSize: SQUARE_TARGET },
        ),
        cutout ? 5 : 4,
        0,
    );
    graph.link("edit", "result");

    if (args.includeUpscale) {
        const col = Math.max(...graph.nodes.map((node) => node.col)) + 1;
        graph.add(
            "upscale",
            "imageGenImageUpscaleNode",
            execData({
                feature: "image-upscale",
                templateId,
                purpose: "product",
                presetId,
                text: "",
                installedBySlot: installed,
                extra: {
                    resolution: "2k",
                    comment:
                        "可选放大。等商品图结果写入后再执行。优先 fal / replicate。",
                },
            }),
            col,
            0,
        );
        graph.link("result", "upscale");
    }

    return graph;
}

function buildHero(
    args: BuildEcommerceTemplateArgs,
    templateId: EcommerceTemplateId,
): GraphBuilder {
    const slots = args.slots ?? {};
    const lead = args.lead ?? "zh";
    const { presetId, text } = promptFor(
        templateId,
        args.presetId,
        slots,
        lead,
        {},
    );
    const path = args.heroPath ?? "fusion";
    const graph = new GraphBuilder();
    const installed = args.installedBySlot;
    const sizeNote =
        "节点输出 1024×1024（画布 1:1）。targetSize 800×800 是平台方图目标，精确缩放不在本模板。";

    if (path === "text-gen") {
        graph.add(
            "prompt",
            "textNode",
            textData(templateId, "main", presetId, text, "主图提示词"),
            0,
            0,
        );
        graph.add(
            "gen",
            "textGenImageNode",
            execData({
                feature: "image-gen",
                templateId,
                purpose: "main",
                presetId,
                text,
                installedBySlot: installed,
                extra: {
                    texts: [text],
                    ...SQUARE_OUTPUT,
                    targetSize: SQUARE_TARGET,
                    comment: `无参考草稿。一致性弱。${sizeNote}`,
                },
            }),
            1,
            0,
        );
        graph.add(
            "result",
            "imageNode",
            imageData(
                templateId,
                "main",
                "result",
                "主图草稿",
                "purpose=main。纯文生，商品一致性弱。",
                { promptPresetId: presetId, targetSize: SQUARE_TARGET },
            ),
            2,
            0,
        );
        graph.link("prompt", "gen");
        graph.link("gen", "result");
        return graph;
    }

    if (path === "edit") {
        graph.add(
            "upload",
            "addImageNode",
            uploadData(
                templateId,
                "main",
                "上传商品图",
                "只有 1 张参考图时走 image-edit，不走融合。",
            ),
            0,
            0,
        );
        graph.add(
            "product",
            "imageNode",
            imageData(
                templateId,
                "main",
                "product_ref",
                "商品参考",
                "role=product_ref。单图主图路径。",
            ),
            1,
            0,
        );
        graph.add(
            "prompt",
            "textNode",
            textData(templateId, "main", presetId, text, "主图提示词"),
            2,
            0,
        );
        graph.add(
            "edit",
            "imageGenImageNode",
            execData({
                feature: "image-edit",
                templateId,
                purpose: "main",
                presetId,
                text,
                installedBySlot: installed,
                extra: {
                    ...SQUARE_OUTPUT,
                    targetSize: SQUARE_TARGET,
                    comment: `单参考图回退到 image-edit。融合节点要求至少 2 张图。${sizeNote}`,
                },
            }),
            3,
            0,
        );
        graph.add(
            "result",
            "imageNode",
            imageData(
                templateId,
                "main",
                "result",
                "主图结果",
                "purpose=main。",
                { promptPresetId: presetId, targetSize: SQUARE_TARGET },
            ),
            4,
            0,
        );
        graph.link("upload", "product");
        graph.link("product", "edit");
        graph.link("prompt", "edit");
        graph.link("edit", "result");
        return graph;
    }

    graph.add(
        "upload-product",
        "addImageNode",
        uploadData(
            templateId,
            "main",
            "上传商品图",
            "写入 Image1（商品身份）。",
        ),
        0,
        0,
    );
    graph.add(
        "upload-detail",
        "addImageNode",
        uploadData(
            templateId,
            "main",
            "上传细节/角度",
            "写入 Image2。可再传一张同商品图。只有 1 张图时请改用单图编辑路径。",
        ),
        0,
        1,
    );
    graph.add(
        "product",
        "imageNode",
        imageData(
            templateId,
            "main",
            "product_ref",
            "Image1 商品",
            "role=product_ref。商品身份以这张为准。",
        ),
        1,
        0,
    );
    graph.add(
        "detail",
        "imageNode",
        imageData(
            templateId,
            "main",
            "product_ref_detail",
            "Image2 细节",
            "role=product_ref_detail。只作细节/角度，不改变 Image1 的商品身份。",
        ),
        1,
        1,
    );
    graph.add(
        "prompt",
        "textNode",
        textData(templateId, "main", presetId, text, "主图提示词"),
        2,
        0,
    );
    graph.add(
        "fusion",
        "imageFusionNode",
        execData({
            feature: "image-fusion",
            templateId,
            purpose: "main",
            presetId,
            text,
            installedBySlot: installed,
            extra: {
                ...SQUARE_OUTPUT,
                targetSize: SQUARE_TARGET,
                comment: `image-fusion 至少需要 2 张已上传的参考图才会允许执行。${sizeNote}`,
            },
        }),
        3,
        0,
    );
    graph.add(
        "result",
        "imageNode",
        imageData(
            templateId,
            "main",
            "result",
            "主图结果",
            "purpose=main。命名建议 {{skuCode}}_main_800x800_v{{version}}.png。",
            { promptPresetId: presetId, targetSize: SQUARE_TARGET },
        ),
        4,
        0,
    );
    // Edge order is Image1 then Image2. Fusion labels follow this order.
    graph.link("upload-product", "product");
    graph.link("upload-detail", "detail");
    graph.link("product", "fusion");
    graph.link("detail", "fusion");
    graph.link("prompt", "fusion");
    graph.link("fusion", "result");
    return graph;
}

function buildScene(
    args: BuildEcommerceTemplateArgs,
    templateId: EcommerceTemplateId,
): GraphBuilder {
    const slots = args.slots ?? {};
    const lead = args.lead ?? "zh";
    const includeStyle = args.includeStyleRef !== false;
    const { presetId, text } = promptFor(
        templateId,
        args.presetId,
        slots,
        lead,
        { style: includeStyle },
    );
    const graph = new GraphBuilder();
    const installed = args.installedBySlot;
    const roleOrder = includeStyle
        ? ["product_ref", "scene_ref", "style_ref"]
        : ["product_ref", "scene_ref"];
    const seriesId = slots.series_id?.trim() || "{{series_id}}";

    const refs: Array<{
        key: string;
        role: string;
        label: string;
        upload: string;
        comment: string;
        row: number;
    }> = [
        {
            key: "product",
            role: "product_ref",
            label: "Image1 商品",
            upload: "上传商品",
            comment: "role=product_ref。外形、颜色、Logo 以这张为准。",
            row: 0,
        },
        {
            key: "scene",
            role: "scene_ref",
            label: "Image2 场景",
            upload: "上传场景",
            comment: "role=scene_ref。提供空间与道具，不提供商品外形。",
            row: 1,
        },
    ];
    if (includeStyle) {
        refs.push({
            key: "style",
            role: "style_ref",
            label: "Image3 风格",
            upload: "上传风格",
            comment: "role=style_ref。只提供光色与摄影风格，不提供商品外形。",
            row: 2,
        });
    }

    for (const ref of refs) {
        graph.add(
            `upload-${ref.key}`,
            "addImageNode",
            uploadData(templateId, "scene", ref.upload, `写入 ${ref.label}。`),
            0,
            ref.row,
        );
        graph.add(
            ref.key,
            "imageNode",
            imageData(templateId, "scene", ref.role, ref.label, ref.comment),
            1,
            ref.row,
        );
        graph.link(`upload-${ref.key}`, ref.key);
    }

    graph.add(
        "prompt",
        "textNode",
        textData(templateId, "scene", presetId, text, "场景提示词"),
        2,
        0,
    );
    graph.add(
        "fusion",
        "imageFusionNode",
        execData({
            feature: "image-fusion",
            templateId,
            purpose: "scene",
            presetId,
            text,
            installedBySlot: installed,
            extra: {
                ...SCENE_OUTPUT,
                targetSize: { w: SCENE_OUTPUT.width, h: SCENE_OUTPUT.height },
                seriesBaseline: {
                    seriesBaselineId: seriesId,
                    templateId: "ecom.scene.lifestyle",
                    aliasTemplateId: "ecom.scene.context",
                    promptPresetId: presetId,
                    promptSnapshot: text,
                    paramsSnapshot: { ...SCENE_OUTPUT },
                    roleOrder,
                    note: "series_baselines table is not created yet. This snapshot lives on the node until that follow-up.",
                },
                comment:
                    "连线顺序固定为商品 → 场景 → 风格，对应 Image1 / Image2 / Image3。融合至少需要其中 2 张已上传的图。",
            },
        }),
        3,
        0,
    );
    for (const ref of refs) graph.link(ref.key, "fusion");
    graph.link("prompt", "fusion");

    graph.add(
        "result",
        "imageNode",
        imageData(
            templateId,
            "scene",
            "result",
            "场景图结果",
            "purpose=scene。命名建议 {{skuCode}}_scene_{{w}}x{{h}}_v{{version}}.png。",
            {
                promptPresetId: presetId,
                targetSize: { w: SCENE_OUTPUT.width, h: SCENE_OUTPUT.height },
                seriesBaselineId: seriesId,
            },
        ),
        4,
        0,
    );
    graph.link("fusion", "result");

    if (args.includePolish) {
        const polish = composeBilingualPrompt(
            renderPromptBody(POLISH_ZH, slots),
            renderPromptBody(POLISH_EN, slots),
            lead,
        );
        graph.add(
            "polish-prompt",
            "textNode",
            textData(templateId, "scene", presetId, polish, "精修提示词"),
            5,
            1,
        );
        graph.add(
            "polish",
            "imageGenImageNode",
            execData({
                feature: "image-edit",
                templateId,
                purpose: "scene",
                presetId,
                text: polish,
                installedBySlot: installed,
                extra: {
                    match_input_size: true,
                    comment: "可选精修。等场景图结果写入后再执行。",
                },
            }),
            5,
            0,
        );
        graph.add(
            "polished",
            "imageNode",
            imageData(
                templateId,
                "scene",
                "result_polished",
                "场景精修结果",
                "purpose=scene。图编辑精修结果。",
                { promptPresetId: presetId },
            ),
            6,
            0,
        );
        graph.link("result", "polish");
        graph.link("polish-prompt", "polish");
        graph.link("polish", "polished");
    }

    return graph;
}

export function buildEcommerceTemplate(
    args: BuildEcommerceTemplateArgs,
): EcommerceGraph {
    const templateId = canonicalTemplateId(args.templateId);
    if (!templateId) {
        throw new Error(`Unknown ecommerce template: ${args.templateId}`);
    }
    const createId = args.createId ?? defaultCreateId;
    const builder =
        templateId === "ecom.product.clean"
            ? buildProduct(args, templateId)
            : templateId === "ecom.main.hero"
              ? buildHero(args, templateId)
              : buildScene(args, templateId);
    const graph = materialize(builder, args.existingNodes ?? [], createId);
    return { templateId, ...graph };
}

/**
 * Append a template to the live canvas. Existing nodes and edges stay.
 * One undo step restores the canvas to the pre-drop document.
 */
export function applyEcommerceTemplate(
    store: EcommerceFlowApi,
    args: BuildEcommerceTemplateArgs,
): EcommerceGraph {
    const state = store.getState();
    const graph = buildEcommerceTemplate({
        ...args,
        existingNodes: state.nodes,
    });
    state.commitHistory();
    state.setNodes(state.nodes.concat(graph.nodes));
    state.setEdges(state.edges.concat(graph.edges));
    const created = graph.nodes.map((node) => node.id);
    state.nodeCreatedCallbacks.forEach((callback) => callback(created));
    return graph;
}
