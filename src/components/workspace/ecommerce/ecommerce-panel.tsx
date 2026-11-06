"use client";

/**
 * Additive ecommerce shortcut drawer.
 * Drops a template graph onto the current canvas. It does not replace nodes,
 * the node catalog, or the video / Agent / plugin toolbars.
 */

import { ShoppingBag } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import {
    applyEcommerceTemplate,
    defaultPresetId,
    type EcommerceTemplateId,
    type HeroPath,
    presetsFor,
    slotsFor,
} from "tongflow";
import {
    Button,
    Input,
    Label,
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
    Tooltip,
    TooltipContent,
    TooltipTrigger,
    useFlow,
    usePluginsRegistry,
    usePluginsRegistryStore,
} from "tongflow/canvas";

const TEMPLATE_ORDER: EcommerceTemplateId[] = [
    "ecom.product.clean",
    "ecom.main.hero",
    "ecom.scene.lifestyle",
];

export function EcommercePanel() {
    const t = useTranslations("Ecommerce");
    usePluginsRegistry();
    const [open, setOpen] = useState(false);
    const [templateId, setTemplateId] =
        useState<EcommerceTemplateId>("ecom.product.clean");
    const [presetId, setPresetId] = useState(
        defaultPresetId("ecom.product.clean"),
    );
    const [slots, setSlots] = useState<Record<string, string>>({});
    const [lead, setLead] = useState<"zh" | "en">("zh");
    const [heroPath, setHeroPath] = useState<HeroPath>("fusion");
    const [includeMatting, setIncludeMatting] = useState(false);
    const [includeUpscale, setIncludeUpscale] = useState(false);
    const [includeStyleRef, setIncludeStyleRef] = useState(true);
    const [includePolish, setIncludePolish] = useState(false);

    useEffect(() => {
        const presets = presetsFor(templateId);
        if (!presets.some((preset) => preset.id === presetId)) {
            setPresetId(defaultPresetId(templateId));
        }
    }, [templateId, presetId]);

    const presets = presetsFor(templateId);
    const slotDefs = slotsFor(templateId);

    const apply = () => {
        const installedBySlot =
            usePluginsRegistryStore.getState().registry?.nodePluginMap;
        const graph = applyEcommerceTemplate(useFlow, {
            templateId,
            presetId,
            slots,
            lead,
            heroPath,
            includeMatting,
            includeUpscale,
            includeStyleRef,
            includePolish,
            installedBySlot,
        });
        toast.success(t("applied", { id: graph.templateId }));
    };

    return (
        <>
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("open")}
                        data-testid="ecommerce-panel-trigger"
                        onClick={() => setOpen(true)}
                        className="h-10 w-10 rounded-xl bg-white border border-gray-100 hover:bg-gray-50 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-700 transition-all duration-200"
                    >
                        <ShoppingBag className="h-5 w-5 text-gray-600 dark:text-gray-200" />
                    </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t("open")}</TooltipContent>
            </Tooltip>

            <Sheet open={open} onOpenChange={setOpen}>
                <SheetContent
                    side="right"
                    className="w-full gap-0 sm:max-w-[440px]"
                >
                    <SheetHeader>
                        <SheetTitle>{t("title")}</SheetTitle>
                        <SheetDescription>{t("description")}</SheetDescription>
                    </SheetHeader>
                    <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-4">
                        <div className="grid gap-2">
                            {TEMPLATE_ORDER.map((id) => {
                                const selected = id === templateId;
                                const titleKey =
                                    id === "ecom.product.clean"
                                        ? "templates.product"
                                        : id === "ecom.main.hero"
                                          ? "templates.hero"
                                          : "templates.scene";
                                const hintKey =
                                    id === "ecom.product.clean"
                                        ? "templates.productHint"
                                        : id === "ecom.main.hero"
                                          ? "templates.heroHint"
                                          : "templates.sceneHint";
                                return (
                                    <button
                                        key={id}
                                        type="button"
                                        data-testid={`ecommerce-template-${id}`}
                                        onClick={() => setTemplateId(id)}
                                        className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                                            selected
                                                ? "border-primary bg-primary/5"
                                                : "border-border hover:bg-muted/50"
                                        }`}
                                    >
                                        <div className="text-sm font-medium">
                                            {t(titleKey)}
                                        </div>
                                        <div className="text-xs text-muted-foreground">
                                            {t(hintKey)} · {id}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>

                        <div className="space-y-1.5">
                            <Label htmlFor="ecom-preset">{t("preset")}</Label>
                            <select
                                id="ecom-preset"
                                value={presetId}
                                onChange={(event) =>
                                    setPresetId(event.target.value)
                                }
                                className="border-input h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                            >
                                {presets.map((preset) => (
                                    <option key={preset.id} value={preset.id}>
                                        {preset.labelZh} · {preset.id}
                                    </option>
                                ))}
                            </select>
                        </div>

                        {templateId === "ecom.main.hero" && (
                            <fieldset className="space-y-1.5">
                                <legend className="text-sm font-medium">
                                    {t("heroPath")}
                                </legend>
                                {(
                                    [
                                        ["fusion", "heroFusion"],
                                        ["edit", "heroEdit"],
                                        ["text-gen", "heroText"],
                                    ] as const
                                ).map(([value, key]) => (
                                    <label
                                        key={value}
                                        className="flex items-start gap-2 text-sm"
                                    >
                                        <input
                                            type="radio"
                                            name="ecom-hero-path"
                                            className="mt-1"
                                            checked={heroPath === value}
                                            onChange={() => setHeroPath(value)}
                                        />
                                        <span>{t(key)}</span>
                                    </label>
                                ))}
                            </fieldset>
                        )}

                        {templateId === "ecom.product.clean" && (
                            <div className="space-y-2 text-sm">
                                <label className="flex items-start gap-2">
                                    <input
                                        type="checkbox"
                                        className="mt-1"
                                        checked={includeMatting}
                                        onChange={(event) =>
                                            setIncludeMatting(
                                                event.target.checked,
                                            )
                                        }
                                    />
                                    <span>{t("includeMatting")}</span>
                                </label>
                                <label className="flex items-start gap-2">
                                    <input
                                        type="checkbox"
                                        className="mt-1"
                                        checked={includeUpscale}
                                        onChange={(event) =>
                                            setIncludeUpscale(
                                                event.target.checked,
                                            )
                                        }
                                    />
                                    <span>{t("includeUpscale")}</span>
                                </label>
                                {presetId === "preset.product.cutout" && (
                                    <p className="text-xs text-amber-700 dark:text-amber-300">
                                        {t("cutoutNote")}
                                    </p>
                                )}
                            </div>
                        )}

                        {templateId === "ecom.scene.lifestyle" && (
                            <div className="space-y-2 text-sm">
                                <label className="flex items-start gap-2">
                                    <input
                                        type="checkbox"
                                        className="mt-1"
                                        checked={includeStyleRef}
                                        onChange={(event) =>
                                            setIncludeStyleRef(
                                                event.target.checked,
                                            )
                                        }
                                    />
                                    <span>{t("includeStyle")}</span>
                                </label>
                                <label className="flex items-start gap-2">
                                    <input
                                        type="checkbox"
                                        className="mt-1"
                                        checked={includePolish}
                                        onChange={(event) =>
                                            setIncludePolish(
                                                event.target.checked,
                                            )
                                        }
                                    />
                                    <span>{t("includePolish")}</span>
                                </label>
                            </div>
                        )}

                        <div className="space-y-2">
                            <div>
                                <div className="text-sm font-medium">
                                    {t("slots")}
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    {t("slotsHint")}
                                </p>
                            </div>
                            {slotDefs.map((slot) => (
                                <div key={slot.key} className="space-y-1">
                                    <Label htmlFor={`ecom-slot-${slot.key}`}>
                                        {slot.labelZh}
                                        <span className="ml-1 font-normal text-muted-foreground">
                                            {`{{${slot.key}}}`}
                                        </span>
                                    </Label>
                                    <Input
                                        id={`ecom-slot-${slot.key}`}
                                        value={slots[slot.key] ?? ""}
                                        placeholder={slot.example}
                                        onChange={(event) =>
                                            setSlots((current) => ({
                                                ...current,
                                                [slot.key]: event.target.value,
                                            }))
                                        }
                                    />
                                </div>
                            ))}
                        </div>

                        <fieldset className="space-y-1.5">
                            <legend className="text-sm font-medium">
                                {t("lead")}
                            </legend>
                            <label className="flex items-center gap-2 text-sm">
                                <input
                                    type="radio"
                                    name="ecom-lead"
                                    checked={lead === "zh"}
                                    onChange={() => setLead("zh")}
                                />
                                {t("leadZh")}
                            </label>
                            <label className="flex items-center gap-2 text-sm">
                                <input
                                    type="radio"
                                    name="ecom-lead"
                                    checked={lead === "en"}
                                    onChange={() => setLead("en")}
                                />
                                {t("leadEn")}
                            </label>
                        </fieldset>

                        <p className="text-xs text-muted-foreground">
                            {t("how")}
                        </p>

                        <div className="space-y-1 rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                            <div className="font-medium text-foreground">
                                {t("gapTitle")}
                            </div>
                            <p>{t("gapMatting")}</p>
                            <p>{t("gapFusion")}</p>
                            <p>{t("gapSize")}</p>
                            <p>{t("gapSku")}</p>
                        </div>
                    </div>
                    <div className="border-t p-4">
                        <Button
                            type="button"
                            className="w-full"
                            data-testid="ecommerce-apply"
                            onClick={apply}
                        >
                            {t("apply")}
                        </Button>
                    </div>
                </SheetContent>
            </Sheet>
        </>
    );
}
