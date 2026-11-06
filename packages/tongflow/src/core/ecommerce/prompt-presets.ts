/**
 * Ecommerce prompt presets.
 *
 * Bodies are the Chinese and English copy from the ecommerce template note.
 * `{{slot}}` markers stay in the string until a non-empty slot value replaces
 * them. `{{#name}}...{{/name}}` blocks are kept only when that block is enabled
 * (used for the optional style reference sentence).
 */

export const ECOM_TEMPLATE_IDS = [
    "ecom.product.clean",
    "ecom.main.hero",
    "ecom.scene.lifestyle",
] as const;

export type EcommerceTemplateId = (typeof ECOM_TEMPLATE_IDS)[number];

/**
 * Design-note id for the same lifestyle scene graph. Canonical id stored on
 * nodes is `ecom.scene.lifestyle`.
 */
export const ECOM_SCENE_CONTEXT_ALIAS = "ecom.scene.context";

export function canonicalTemplateId(
    id: string,
): EcommerceTemplateId | undefined {
    if (id === ECOM_SCENE_CONTEXT_ALIAS) return "ecom.scene.lifestyle";
    return (ECOM_TEMPLATE_IDS as readonly string[]).includes(id)
        ? (id as EcommerceTemplateId)
        : undefined;
}

export interface SlotDef {
    key: string;
    labelZh: string;
    labelEn: string;
    example: string;
}

export interface PromptPreset {
    id: string;
    templateId: EcommerceTemplateId;
    labelZh: string;
    labelEn: string;
    zh: string;
    en: string;
}

/** Documented follow-ups that this module does not implement. */
export const ECOM_KNOWN_GAPS = [
    "image-matting is not declared by tongflow-api-openai / gemini / bytedance. The product template's default path is image-edit on a white background. The matting node is an optional branch and needs fal, replicate, or a Modal matting plugin.",
    "imageFusionNode stays disabled until at least two upstream image nodes have fileKeys. The hero template can fall back to image-edit when there is only one reference.",
    "The square size picker baseline is 1024×1024. 800×800 is recorded as targetSize metadata. There is no sharp resize node.",
] as const;

/** Schema tables named by the design note and intentionally not migrated. */
export const ECOM_FOLLOW_UP_TABLES = [
    "products",
    "skus",
    "image_versions",
    "deliverables",
    "delivery_targets",
    "series_baselines",
] as const;

const BLOCK_RE = /\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g;
const SLOT_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/**
 * Render one preset body.
 * Enabled blocks are unwrapped; disabled blocks are removed.
 * A slot is replaced only when `slots[key]` is a non-empty string.
 */
export function renderPromptBody(
    body: string,
    slots: Record<string, string | undefined>,
    blocks: Record<string, boolean> = {},
): string {
    const unwrapped = body.replace(
        BLOCK_RE,
        (_whole, name: string, inner: string) => (blocks[name] ? inner : ""),
    );
    return unwrapped.replace(SLOT_RE, (whole, key: string) => {
        const value = slots[key];
        if (typeof value !== "string" || value.trim() === "") return whole;
        return value.trim();
    });
}

/** Chinese then English, or the reverse when `lead` is `en`. One executable string. */
export function composeBilingualPrompt(
    zh: string,
    en: string,
    lead: "zh" | "en" = "zh",
): string {
    const primary = lead === "en" ? en.trim() : zh.trim();
    const secondary = lead === "en" ? zh.trim() : en.trim();
    return `${primary}\n\n${secondary}`;
}

export const ECOM_SLOTS: Record<EcommerceTemplateId, readonly SlotDef[]> = {
    "ecom.product.clean": [
        {
            key: "product_name",
            labelZh: "产品名",
            labelEn: "Product name",
            example: "陶瓷马克杯",
        },
        {
            key: "category",
            labelZh: "品类",
            labelEn: "Category",
            example: "杯具",
        },
        {
            key: "material",
            labelZh: "材质/表面",
            labelEn: "Material",
            example: "哑光白瓷、木纹手柄",
        },
        {
            key: "keep_logo",
            labelZh: "是否保留 Logo",
            labelEn: "Keep logo",
            example: "否",
        },
        {
            key: "bg_mode",
            labelZh: "背景模式",
            labelEn: "Background",
            example: "white",
        },
    ],
    "ecom.main.hero": [
        {
            key: "product_name",
            labelZh: "产品名",
            labelEn: "Product name",
            example: "降噪耳机 Pro",
        },
        {
            key: "selling_points",
            labelZh: "卖点（1–3 条）",
            labelEn: "Selling points",
            example: "40h 续航；主动降噪；轻至 45g",
        },
        {
            key: "audience",
            labelZh: "人群/场景",
            labelEn: "Audience",
            example: "通勤办公",
        },
        {
            key: "platform",
            labelZh: "平台",
            labelEn: "Platform",
            example: "淘宝主图",
        },
        {
            key: "must_show",
            labelZh: "必须看见的部件",
            labelEn: "Must show",
            example: "Logo 朝前、充电盒同框",
        },
        {
            key: "forbid",
            labelZh: "禁止",
            labelEn: "Forbidden",
            example: "虚假认证标、夸张医疗宣称",
        },
    ],
    "ecom.scene.lifestyle": [
        {
            key: "product_name",
            labelZh: "产品名",
            labelEn: "Product name",
            example: "香薰蜡烛",
        },
        {
            key: "scene_desc",
            labelZh: "场景描述",
            labelEn: "Scene",
            example: "北欧客厅茶几，午后窗光",
        },
        {
            key: "camera",
            labelZh: "机位",
            labelEn: "Camera",
            example: "45° 俯拍",
        },
        {
            key: "mood",
            labelZh: "情绪",
            labelEn: "Mood",
            example: "安静、温暖",
        },
        {
            key: "integration",
            labelZh: "融合强度",
            labelEn: "Integration",
            example: "商品真实融入，接触阴影自然",
        },
        {
            key: "series_id",
            labelZh: "系列基准 id",
            labelEn: "Series baseline id",
            example: "baseline_candle_living_v1",
        },
    ],
};

export const ECOM_PRESETS: readonly PromptPreset[] = [
    {
        id: "preset.product.white_minimal",
        templateId: "ecom.product.clean",
        labelZh: "极简白底",
        labelEn: "White minimal",
        zh: `保留原图中「{{product_name}}」（品类：{{category}}）的外形、比例、材质与细节，不要改变商品结构或颜色。
清除桌面杂物、手指、吊牌线头、阴影污渍与文字水印。
将背景替换为干净纯白（#FFFFFF），商品居中，四周留白均匀，影棚柔和顶光，阴影极轻或无阴影。
材质表现准确（{{material}}），边缘锐利，电商目录级清晰度。
不要添加道具、人物、logo（除非原图已有且需保留：{{keep_logo}}），不要变形、不要二次创作成新商品。`,
        en: `Keep the exact shape, proportions, materials, and details of the "{{product_name}}" ({{category}}) from the input photo. Do not redesign the product.
Remove clutter, hands, tags, dust, stains, and watermarks.
Replace the background with clean pure white (#FFFFFF). Center the product with even padding. Soft studio top light, minimal or no shadow.
Accurate material look ({{material}}), sharp edges, catalog-grade clarity.
No extra props, people, or new logos (keep existing logo only if {{keep_logo}}=yes). No warping or inventing a different product.`,
    },
    {
        id: "preset.product.studio_soft",
        templateId: "ecom.product.clean",
        labelZh: "影棚柔光",
        labelEn: "Studio soft",
        zh: `以输入图中的「{{product_name}}」为准，保持商品真实外形与 {{material}} 质感。
背景改为浅灰到白色的无缝影棚纸，柔光箱左右补光，接触阴影自然但干净。
去除杂乱背景与瑕疵；商品略呈 3/4 视角更佳（若原图已是正面则保持正面）。
高清电商静物风格，无文字、无贴纸、无人物。`,
        en: `Faithfully preserve the "{{product_name}}" from the input, including {{material}} texture.
Place it on a seamless light-gray-to-white studio sweep with softbox lighting and a clean contact shadow.
Remove clutter and blemishes; keep the original viewing angle unless a subtle 3/4 improvement helps.
Catalog still-life look; no text, stickers, or people.`,
    },
    {
        id: "preset.product.cutout",
        templateId: "ecom.product.clean",
        labelZh: "透明抠图后铺白",
        labelEn: "Cutout then white",
        zh: `将透明背景上的「{{product_name}}」铺到纯白背景，居中，边缘抗锯齿，不改变商品本身。`,
        en: `Composite the cut-out "{{product_name}}" onto a pure white background, centered, clean anti-aliased edges, no product changes.`,
    },
    {
        id: "preset.main.white_hero",
        templateId: "ecom.main.hero",
        labelZh: "极简白底主图",
        labelEn: "White hero",
        zh: `电商主图，正方形构图。主体是 Image1 中的「{{product_name}}」，必须与参考商品一致，禁止换成其它型号。
纯白或浅灰无缝背景，商品居中略偏下，顶部留出可加标题的安全区（不要生成文字）。
突出卖点氛围（不要把文字写进画面）：{{selling_points}}。
目标人群：{{audience}}。必须展示：{{must_show}}。禁止：{{forbid}}。
影棚柔光，边缘清晰，材质真实，高清，无水印、无价格标签、无促销贴纸。
若有 Image2，仅作细节/角度参考，仍以 Image1 商品身份为准。`,
        en: `Square e-commerce hero image. The product in Image1 ("{{product_name}}") must match the reference exactly—do not substitute another model.
Seamless white or light-gray background; product centered slightly low; keep a clean top safe area for later title overlay (do NOT render any text in the image).
Evoke these selling points without drawing text: {{selling_points}}.
Audience: {{audience}}. Must show: {{must_show}}. Forbidden: {{forbid}}.
Soft studio light, sharp edges, true materials, no watermarks or price stickers.
If Image2 exists, use it only for detail/angle cues; product identity follows Image1.`,
    },
    {
        id: "preset.main.studio_glow",
        templateId: "ecom.main.hero",
        labelZh: "影棚柔光主图",
        labelEn: "Studio glow",
        zh: `以 Image1 的「{{product_name}}」为唯一商品。影棚柔光 + 轻微地面反光，背景浅灰渐变。
构图饱满但不裁切关键部件（{{must_show}}）。传递卖点：{{selling_points}}。
高级感静物摄影，正方形，无文字、无人物、无夸张特效。`,
        en: `Single product from Image1 ("{{product_name}}"). Soft studio light with a subtle floor reflection on a light-gray gradient.
Fill the square frame without cropping critical parts ({{must_show}}). Communicate: {{selling_points}}.
Premium still life; no text, people, or heavy VFX.`,
    },
    {
        id: "preset.main.lifestyle_soft",
        templateId: "ecom.main.hero",
        labelZh: "生活方式主图（克制）",
        labelEn: "Soft lifestyle hero",
        zh: `主图偏生活方式但商品仍占画面 ≥60%。场景简洁（{{audience}}），虚化背景，商品来自 Image1「{{product_name}}」，外形与颜色必须一致。
不要生成可读文字。卖点只通过场景暗示：{{selling_points}}。禁止杂乱背景与无关品牌。`,
        en: `Lifestyle-leaning hero where the product still occupies ≥60% of the frame. Simple setting for {{audience}}, soft bokeh background.
Product identity from Image1 ("{{product_name}}") must stay exact. No readable text. Suggest benefits only via scene: {{selling_points}}.`,
    },
    {
        id: "preset.scene.lifestyle",
        templateId: "ecom.scene.lifestyle",
        labelZh: "生活方式场景",
        labelEn: "Lifestyle scene",
        zh: `将 Image1 中的商品「{{product_name}}」真实放入 Image2 的场景（{{scene_desc}}）。
严格保持 Image1 的外形、比例、颜色与品牌标识；不得替换或美化成其它产品。
Image2 提供空间与道具；{{#style}}Image3 仅提供光色与摄影风格，不提供商品外形。{{/style}}
机位：{{camera}}。情绪：{{mood}}。{{integration}}。
商品与场景接触处要有合理阴影与透视；不要生成可读文字或水印。`,
        en: `Place the product in Image1 ("{{product_name}}") into the scene of Image2 ({{scene_desc}}).
Strictly keep Image1 shape, proportions, colors, and branding; do not swap products.
Image2 drives set and props; {{#style}}Image3 drives lighting and grade only, not product shape.{{/style}}
Camera: {{camera}}. Mood: {{mood}}. {{integration}}.
Believable contact shadows and perspective. No readable text or watermarks.`,
    },
    {
        id: "preset.scene.studio_set",
        templateId: "ecom.scene.lifestyle",
        labelZh: "影棚场景化",
        labelEn: "Studio set",
        zh: `Image1 商品「{{product_name}}」置于 Image2 所示的干净台面/道具组合中，背景简洁。
保留商品真实材质；补光柔和；可有一件与卖点相关的极简道具，禁止杂乱。
正方形或 4:3 构图，目录级清晰。`,
        en: `Seat Image1 product "{{product_name}}" into the clean surface/prop kit from Image2.
Keep true materials; soft fill light; at most one minimal prop tied to the story; no clutter.
Square or 4:3, catalog clarity.`,
    },
    {
        id: "preset.scene.minimal_negative",
        templateId: "ecom.scene.lifestyle",
        labelZh: "极简留白场景",
        labelEn: "Minimal negative space",
        zh: `大面积留白或浅色负空间，Image1「{{product_name}}」偏一侧构图，Image2 仅提供极简环境线索。
高级感、少道具、真实比例，无文字。`,
        en: `Large negative space; Image1 "{{product_name}}" offset in frame; Image2 only supplies minimal environment cues.
Premium, sparse, true proportions, no text.`,
    },
];

const DEFAULT_PRESET: Record<EcommerceTemplateId, string> = {
    "ecom.product.clean": "preset.product.white_minimal",
    "ecom.main.hero": "preset.main.white_hero",
    "ecom.scene.lifestyle": "preset.scene.lifestyle",
};

export function presetsFor(
    templateId: EcommerceTemplateId,
): readonly PromptPreset[] {
    return ECOM_PRESETS.filter((preset) => preset.templateId === templateId);
}

export function defaultPresetId(templateId: EcommerceTemplateId): string {
    return DEFAULT_PRESET[templateId];
}

export function presetById(
    templateId: EcommerceTemplateId,
    presetId: string | undefined,
): PromptPreset {
    const list = presetsFor(templateId);
    return list.find((preset) => preset.id === presetId) ?? list[0];
}

export function slotsFor(templateId: EcommerceTemplateId): readonly SlotDef[] {
    return ECOM_SLOTS[templateId];
}
