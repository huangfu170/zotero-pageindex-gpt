import { config } from "../package.json";
import { getString, initLocale } from "./modules/locale";
import Views from "./modules/views";
import Utils from "./modules/utils";
import { initValidation } from "./validation/core";

const PREFERENCE_PANE_ID = `${config.addonRef}-preferences`;
const initializedWindows = new WeakSet<Window>();
type ApiConfig = {
  id: string;
  name: string;
  api: string;
  secretKey?: string;
  model: string;
};

const DEFAULT_API_CONFIGS: ApiConfig[] = [
  {
    id: "longcat",
    name: "LongCat",
    api: "https://api.longcat.chat/openai",
    model: "LongCat-2.0-Preview",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    api: "https://api.deepseek.com",
    model: "deepseek-chat",
  },
  {
    id: "openai",
    name: "OpenAI",
    api: "https://api.openai.com",
    model: "gpt-4o-mini",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    api: "https://openrouter.ai/api",
    model: "openai/gpt-4o-mini",
  },
  {
    id: "custom",
    name: "Custom OpenAI-compatible",
    api: "https://api.example.com",
    model: "model-name",
  },
];

const PREFERENCE_LABELS = {
  en: {
    llmSettings: "LLM Settings",
    enable: "Enable",
    apiConfiguration: "API Configuration",
    add: "Add",
    edit: "Edit",
    saveCurrent: "Save Current",
    duplicate: "Duplicate",
    delete: "Delete",
    restoreDefaults: "Restore Defaults",
    apiBaseUrl: "API Base URL",
    apiSecretKey: "API Secret Key",
    model: "Model",
    testConnection: "Test Connection",
    advancedSettings: "Advanced Settings",
    maxTokens: "Max Tokens",
    temperature: "Temperature",
    chatItemCount: "Chat Item Count",
    relatedItemCount: "Related Item Count",
    pageIndexSettings: "PageIndex Settings",
    enablePageIndex: "Enable PageIndex",
    advancedPageIndexSettings: "Advanced PageIndex Settings",
    deltaTime: "Delta Time (ms)",
    preset: "preset",
    apiRequired: "API URL, secret key, and model are required.",
    testingModel: (model: string) => `Testing ${model}...`,
    connectionOk: (model: string) => `Connection OK: ${model}`,
    connectionFailed: (message: string) => `Connection failed: ${message}`,
    added: (name: string) => `Added ${name}.`,
    updated: (name: string) => `Updated ${name}.`,
    saved: (name: string) => `Saved ${name}.`,
    duplicated: (name: string) => `Duplicated ${name}.`,
    deleted: (name: string) => `Deleted ${name}.`,
    defaultsRestored: "Default API presets restored.",
    presetsCannotDelete: "Preset configurations cannot be deleted.",
    deleteConfirm: (name: string) => `Delete API configuration "${name}"?`,
    configNamePrompt: "Configuration name",
    apiUrlPrompt: "API Base URL. Use the provider root URL, for example https://api.deepseek.com",
    secretKeyPrompt: "API Secret Key",
    modelPrompt: "Model",
    newConfigNamePrompt: "New configuration name",
    copySuffix: "Copy",
  },
  zh: {
    llmSettings: "LLM 设置",
    enable: "启用",
    apiConfiguration: "API 配置",
    add: "新增",
    edit: "编辑",
    saveCurrent: "保存当前",
    duplicate: "复制",
    delete: "删除",
    restoreDefaults: "恢复默认",
    apiBaseUrl: "API 基础地址",
    apiSecretKey: "API 密钥",
    model: "模型",
    testConnection: "测试连接",
    advancedSettings: "高级设置",
    maxTokens: "最大 Token 数",
    temperature: "温度",
    chatItemCount: "聊天历史条数",
    relatedItemCount: "相关内容条数",
    pageIndexSettings: "PageIndex 设置",
    enablePageIndex: "启用 PageIndex",
    pageIndexBackend: "PageIndex 后端",
    builtinBackend: "内置 Zotero 解析器",
    pythonService: "Python PageIndex 服务",
    serviceUrl: "服务地址",
    testService: "测试服务",
    advancedPageIndexSettings: "PageIndex 高级设置",
    deltaTime: "响应延迟 (ms)",
    preset: "预设",
    builtInActive: "当前使用内置后端，不需要 Python 服务。",
    apiRequired: "需要填写 API 地址、密钥和模型。",
    testingModel: (model: string) => `正在测试 ${model}...`,
    connectionOk: (model: string) => `连接正常：${model}`,
    connectionFailed: (message: string) => `连接失败：${message}`,
    added: (name: string) => `已新增 ${name}。`,
    updated: (name: string) => `已更新 ${name}。`,
    saved: (name: string) => `已保存 ${name}。`,
    duplicated: (name: string) => `已复制 ${name}。`,
    deleted: (name: string) => `已删除 ${name}。`,
    defaultsRestored: "已恢复默认 API 预设。",
    presetsCannotDelete: "预设配置不能删除。",
    deleteConfirm: (name: string) => `删除 API 配置“${name}”？`,
    configNamePrompt: "配置名称",
    apiUrlPrompt: "API 基础地址。填写服务商根地址，例如 https://api.deepseek.com",
    secretKeyPrompt: "API 密钥",
    modelPrompt: "模型",
    newConfigNamePrompt: "新配置名称",
    copySuffix: "副本",
    pageIndexUrlRequired: "需要填写 PageIndex 服务地址。",
    testingPageIndex: "正在测试 PageIndex 服务...",
    serviceOk: (version: string) => `服务正常：${version || "healthy"}`,
    serviceBad: "服务有响应，但没有返回健康状态。",
    serviceFailed: (message: string) => `服务测试失败：${message}`,
  },
};

function bindMainWindow(win: Window) {
  _globalThis.__bindMainWindow?.(win);
}

function registerToolsMenu(win: Window) {
  const menuId = `${config.addonRef}-open-window`;
  const doc = win.document;
  doc.querySelector(`#${menuId}`)?.remove();
  const menuPopup = doc.querySelector("#menu_ToolsPopup");
  if (!menuPopup) {
    ztoolkit.log("Tools menu popup not found");
    return;
  }
  const menuItem = (doc as any).createXULElement("menuitem");
  menuItem.id = menuId;
  menuItem.setAttribute("label", config.addonName);
  menuItem.setAttribute("class", "menuitem-iconic");
  menuItem.setAttribute("image", `chrome://${config.addonRef}/content/icons/favicon.png`);
  menuItem.addEventListener("command", () => {
    bindMainWindow(win);
    Zotero[config.addonInstance].views.show();
  });
  menuPopup.appendChild(menuItem);
}

async function onStartup() {
  Zotero.Prefs.set(
    `${config.addonRef}.diagnosticStage`,
    `hooks-startup:${Date.now()}`
  );
  initValidation(config.addonRef); 
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);
  initLocale();
  ztoolkit.ProgressWindow.setIconURI(
    "default",
    `chrome://${config.addonRef}/content/icons/favicon.png`
  );

  Zotero[config.addonInstance].utils = new Utils();

  const windows =
    typeof Zotero.getMainWindows === "function"
      ? Zotero.getMainWindows()
      : [Zotero.getMainWindow()].filter(Boolean);

  if (
    Zotero.PreferencePanes &&
    typeof Zotero.PreferencePanes.register === "function"
  ) {
    if (
      Zotero.PreferencePanes.pluginPanes &&
      Array.isArray((Zotero.PreferencePanes as any).pluginPanes)
    ) {
      [...((Zotero.PreferencePanes as any).pluginPanes as any[])].forEach((pane: any) => {
        if (
          pane?.pluginID === config.addonID ||
          (typeof pane?.id === "string" &&
            pane.id.includes(config.addonRef))
        ) {
          try {
            Zotero.PreferencePanes.unregister(pane.id);
          } catch {
            // Ignore stale panes from older bootstrap states.
          }
        }
      });
    }
    if (addon.data.preferencePaneID) {
      try {
        Zotero.PreferencePanes.unregister(addon.data.preferencePaneID);
      } catch {}
    }
    addon.data.preferencePaneID = await Zotero.PreferencePanes.register({
      pluginID: config.addonID,
      id: PREFERENCE_PANE_ID,
      src: `chrome://${config.addonRef}/content/preferences.xhtml`,
    });
  }

  await Promise.all(windows.map((win) => onMainWindowLoad(win)));
  Zotero.Prefs.set(
    `${config.addonRef}.diagnosticStage`,
    `hooks-startup-complete:${Date.now()}`
  );
  ztoolkit.log(`${config.addonName} startup completed`);
}

async function onMainWindowLoad(win: Window) {
  if (initializedWindows.has(win)) {
    return;
  }
  initializedWindows.add(win);
  bindMainWindow(win);
  Zotero.Prefs.set(
    `${config.addonRef}.diagnosticStage`,
    `main-window-load:${Date.now()}`
  );

  Zotero[config.addonInstance].views = new Views();

  try {
    registerToolsMenu(win);
  } catch (error) {
    ztoolkit.log("Failed to register tools menu", error);
  }
  ztoolkit.log(`${config.addonName} main window loaded`);
}

function bindPreferenceControl(element: Element) {
  const pref = element.getAttribute("preference");
  if (!pref) {
    return;
  }
  if (pref === "apiProvider") {
    return;
  }
  const fullPref = `${config.addonRef}.${pref}`;
  const input = element as HTMLInputElement & XUL.Checkbox & { __pageIndexPrefBound?: boolean };
  if (input.__pageIndexPrefBound) {
    return;
  }
  input.__pageIndexPrefBound = true;

  const isCheckbox =
    element.localName === "checkbox" ||
    input.getAttribute("type") === "checkbox";
  const isNumber = input.getAttribute("type") === "number";

  const currentValue = Zotero.Prefs.get(fullPref);
  if (typeof currentValue !== "undefined") {
    if (isCheckbox) {
      input.checked = Boolean(currentValue);
    } else {
      input.value = String(currentValue ?? "");
    }
  }

  const save = () => {
    const value = isCheckbox
      ? Boolean(input.checked)
      : isNumber
        ? Number(input.value)
        : input.value;
    if (isNumber && Number.isNaN(value)) {
      return;
    }
    Zotero.Prefs.set(fullPref, value);
  };

  element.addEventListener(isCheckbox ? "command" : "change", save);
  if (!isCheckbox) {
    element.addEventListener("input", save);
  }
}

function getZoteroLocale() {
  const candidates = [
    (Zotero as any).locale,
    Zotero.Prefs.get("intl.locale.requested"),
    Zotero.Prefs.get("general.useragent.locale"),
    (() => {
      try {
        return Services.locale.appLocaleAsBCP47;
      } catch {
        return "";
      }
    })(),
  ];
  return String(candidates.find((locale) => String(locale || "").trim()) || "en-US");
}

function getPreferenceLanguage() {
  return /^zh\b|^zh-/i.test(getZoteroLocale()) ? "zh" : "en";
}

function prefText(win: Window) {
  return PREFERENCE_LABELS[getPreferenceLanguage()];
}

function setElementText(win: Window, selector: string, text: string) {
  const element = win.document.querySelector(selector);
  if (element) {
    element.textContent = text;
  }
}

function localizePreferencePane(win: Window) {
  const text = prefText(win);
  const pairs: Array<[string, string]> = [
    [`#zotero-prefpane-${config.addonRef}-llm-title`, text.llmSettings],
    [`#zotero-prefpane-${config.addonRef}-api-provider-label`, text.apiConfiguration],
    [`#zotero-prefpane-${config.addonRef}-add-api-config`, text.add],
    [`#zotero-prefpane-${config.addonRef}-edit-api-config`, text.edit],
    [`#zotero-prefpane-${config.addonRef}-save-api-config`, text.saveCurrent],
    [`#zotero-prefpane-${config.addonRef}-duplicate-api-config`, text.duplicate],
    [`#zotero-prefpane-${config.addonRef}-delete-api-config`, text.delete],
    [`#zotero-prefpane-${config.addonRef}-restore-api-defaults`, text.restoreDefaults],
    [`#zotero-prefpane-${config.addonRef}-api-label`, text.apiBaseUrl],
    [`#zotero-prefpane-${config.addonRef}-secret-key-label`, text.apiSecretKey],
    [`#zotero-prefpane-${config.addonRef}-model-label`, text.model],
    [`#zotero-prefpane-${config.addonRef}-test-api-config`, text.testConnection],
    [`#zotero-prefpane-${config.addonRef}-toggle-advanced`, text.advancedSettings],
    [`#zotero-prefpane-${config.addonRef}-max-tokens-label`, text.maxTokens],
    [`#zotero-prefpane-${config.addonRef}-temperature-label`, text.temperature],
    [`#zotero-prefpane-${config.addonRef}-chat-number-label`, text.chatItemCount],
    [`#zotero-prefpane-${config.addonRef}-related-number-label`, text.relatedItemCount],
    [`#zotero-prefpane-${config.addonRef}-page-index-title`, text.pageIndexSettings],
    [`#zotero-prefpane-${config.addonRef}-toggle-page-index-advanced`, text.advancedPageIndexSettings],
    [`#zotero-prefpane-${config.addonRef}-delta-time-label`, text.deltaTime],
  ];
  pairs.forEach(([selector, value]) => setElementText(win, selector, value));
  const enable = win.document.querySelector(`#zotero-prefpane-${config.addonRef}-enable`);
  enable?.setAttribute("label", text.enable);
  const enablePageIndex = win.document.querySelector(`#zotero-prefpane-${config.addonRef}-page-index-enabled`);
  enablePageIndex?.setAttribute("label", text.enablePageIndex);
}

function getApiConfigs(): ApiConfig[] {
  const rawConfigs = Zotero.Prefs.get(`${config.addonRef}.apiConfigs`);
  let parsedConfigs: ApiConfig[] = [];
  try {
    parsedConfigs = JSON.parse(String(rawConfigs || "[]"));
  } catch {
    parsedConfigs = [];
  }
  const configs = [...DEFAULT_API_CONFIGS, ...parsedConfigs].reduce(
    (acc, item) => {
      if (
        isUsableConfig(item)
      ) {
        const nextItem = sanitizeApiConfig(item);
        const existingIndex = acc.findIndex((existing) => existing.id === nextItem.id);
        if (existingIndex >= 0) {
          acc[existingIndex] = nextItem;
        } else {
          acc.push(nextItem);
        }
      }
      return acc;
    },
    [] as ApiConfig[],
  );
  return configs;
}

function normalizeApiBase(api: string | undefined) {
  return String(api || "").trim().replace(/\/(?:v1)?\/?$/, "");
}

function isUsableText(value: unknown) {
  const text = String(value ?? "").trim();
  return Boolean(text) && text !== "undefined" && text !== "null";
}

function isUsableConfig(item: Partial<ApiConfig> | undefined) {
  return Boolean(
    item &&
      isUsableText(item.id) &&
      isUsableText(item.name) &&
      isUsableText(item.api) &&
      isUsableText(item.model),
  );
}

function getDefaultApiConfig(id: string) {
  return DEFAULT_API_CONFIGS.find((item) => item.id === id);
}

function isDefaultApiConfig(id: string) {
  return Boolean(getDefaultApiConfig(id));
}

function sanitizeApiConfig(apiConfig: ApiConfig): ApiConfig {
  return {
    ...apiConfig,
    id: String(apiConfig.id).trim(),
    name: String(apiConfig.name).trim(),
    api: normalizeApiBase(apiConfig.api),
    secretKey:
      typeof apiConfig.secretKey === "string"
        ? apiConfig.secretKey.trim()
        : apiConfig.secretKey,
    model: String(apiConfig.model).trim(),
  };
}

function saveApiConfigs(configs: ApiConfig[]) {
  const cleanConfigs = configs
    .map((item) => sanitizeApiConfig(item))
    .filter((item) => isUsableConfig(item));
  Zotero.Prefs.set(`${config.addonRef}.apiConfigs`, JSON.stringify(cleanConfigs));
}

function setPreferenceInputValue(win: Window, pref: string, value: string) {
  const input = win.document.querySelector(`[preference="${pref}"]`) as HTMLInputElement | HTMLSelectElement | null;
  if (input) {
    input.value = value;
  }
}

function applyApiConfig(win: Window, apiConfig: ApiConfig) {
  Zotero.Prefs.set(`${config.addonRef}.apiProvider`, apiConfig.id);
  Zotero.Prefs.set(`${config.addonRef}.api`, normalizeApiBase(apiConfig.api));
  Zotero.Prefs.set(`${config.addonRef}.model`, apiConfig.model);
  if (typeof apiConfig.secretKey === "string" && apiConfig.secretKey.trim()) {
    Zotero.Prefs.set(`${config.addonRef}.secretKey`, apiConfig.secretKey);
    setPreferenceInputValue(win, "secretKey", apiConfig.secretKey);
  } else if (!Zotero.Prefs.get(`${config.addonRef}.secretKey`)) {
    setPreferenceInputValue(win, "secretKey", "");
  }
  setPreferenceInputValue(win, "apiProvider", apiConfig.id);
  setPreferenceInputValue(win, "api", normalizeApiBase(apiConfig.api));
  setPreferenceInputValue(win, "model", apiConfig.model);
  updateApiConfigButtons(win);
}

function createConfigId(name: string, configs: ApiConfig[]) {
  const baseId = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "api";
  let id = baseId;
  let index = 2;
  while (configs.some((item) => item.id === id)) {
    id = `${baseId}-${index}`;
    index += 1;
  }
  return id;
}

function renderApiConfigSelect(win: Window, configs: ApiConfig[]) {
  const select = win.document.querySelector(
    `#zotero-prefpane-${config.addonRef}-api-provider`,
  ) as HTMLSelectElement | null;
  if (!select) {
    return;
  }
  while (select.firstChild) {
    select.firstChild.remove();
  }
  const text = prefText(win);
  configs.forEach((apiConfig) => {
    const option = win.document.createElement("option");
    option.value = apiConfig.id;
    option.textContent = `${apiConfig.name}${isDefaultApiConfig(apiConfig.id) ? ` (${text.preset})` : ""}`;
    select.appendChild(option);
  });
  const currentProvider = String(Zotero.Prefs.get(`${config.addonRef}.apiProvider`) || configs[0]?.id || "");
  select.value = configs.some((apiConfig) => apiConfig.id === currentProvider)
    ? currentProvider
    : configs[0]?.id || "";
}

function getPreferenceInputValue(win: Window, pref: string) {
  const input = win.document.querySelector(`[preference="${pref}"]`) as HTMLInputElement | HTMLSelectElement | null;
  return String(input?.value || "").trim();
}

function getCurrentConfigFromInputs(win: Window, fallback?: ApiConfig): ApiConfig {
  return sanitizeApiConfig({
    id: fallback?.id || createConfigId(getPreferenceInputValue(win, "model") || "api", getApiConfigs()),
    name: fallback?.name || getPreferenceInputValue(win, "model") || "API Configuration",
    api: getPreferenceInputValue(win, "api"),
    secretKey: getPreferenceInputValue(win, "secretKey"),
    model: getPreferenceInputValue(win, "model"),
  });
}

function replaceApiConfig(configs: ApiConfig[], apiConfig: ApiConfig) {
  const nextConfig = sanitizeApiConfig(apiConfig);
  const nextConfigs = configs.filter((item) => item.id !== nextConfig.id);
  nextConfigs.push(nextConfig);
  return nextConfigs;
}

function setStatus(win: Window, id: string, message: string, type: "info" | "success" | "fail" = "info") {
  const node = win.document.querySelector(`#${id}`) as HTMLElement | null;
  if (!node) {
    return;
  }
  node.textContent = message;
  node.style.color = type === "success" ? "#1a7f37" : type === "fail" ? "#cf222e" : "";
}

function updateApiConfigButtons(win: Window) {
  const select = win.document.querySelector(
    `#zotero-prefpane-${config.addonRef}-api-provider`,
  ) as HTMLSelectElement | null;
  const deleteButton = win.document.querySelector(
    `#zotero-prefpane-${config.addonRef}-delete-api-config`,
  ) as HTMLButtonElement | null;
  if (deleteButton && select) {
    deleteButton.disabled = isDefaultApiConfig(select.value);
  }
}

function promptApiConfig(win: Window, initial: ApiConfig, configs: ApiConfig[], forceNewId = false) {
  const text = prefText(win);
  const name = win.prompt(text.configNamePrompt, initial.name);
  if (!name) {
    return undefined;
  }
  const apiUrl = win.prompt(text.apiUrlPrompt, initial.api);
  if (!apiUrl) {
    return undefined;
  }
  const secretKey = win.prompt(text.secretKeyPrompt, initial.secretKey || "");
  if (secretKey === null) {
    return undefined;
  }
  const model = win.prompt(text.modelPrompt, initial.model);
  if (!model) {
    return undefined;
  }
  return sanitizeApiConfig({
    id: forceNewId ? createConfigId(name, configs) : initial.id,
    name,
    api: apiUrl,
    secretKey,
    model,
  });
}

async function testApiConfig(win: Window) {
  const text = prefText(win);
  const api = normalizeApiBase(getPreferenceInputValue(win, "api"));
  const secretKey = getPreferenceInputValue(win, "secretKey");
  const model = getPreferenceInputValue(win, "model");
  const statusId = `zotero-prefpane-${config.addonRef}-api-config-status`;
  if (!api || !secretKey || !model) {
    setStatus(win, statusId, text.apiRequired, "fail");
    return;
  }
  const url = `${api}/v1/chat/completions`;
  setStatus(win, statusId, text.testingModel(model));
  try {
    await Zotero.HTTP.request("POST", url, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secretKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "ping" }],
        stream: false,
        temperature: 0,
        max_tokens: 8,
      }),
      responseType: "json",
    } as any);
    setStatus(win, statusId, text.connectionOk(model), "success");
  } catch (error: any) {
    let message = error?.message || String(error);
    try {
      const parsed = JSON.parse(error?.xmlhttp?.response || "{}").error;
      message = parsed?.message || message;
    } catch {}
    setStatus(win, statusId, text.connectionFailed(message), "fail");
  }
}

function bindToggle(win: Window, buttonId: string, panelId: string) {
  const button = win.document.querySelector(`#${buttonId}`) as (HTMLButtonElement & { __pageIndexToggleBound?: boolean }) | null;
  const panel = win.document.querySelector(`#${panelId}`) as HTMLElement | null;
  if (!button || !panel || button.__pageIndexToggleBound) {
    return;
  }
  button.__pageIndexToggleBound = true;
  button.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
  });
}

function bindApiConfigControls(win: Window) {
  const text = prefText(win);
  let configs = getApiConfigs();
  renderApiConfigSelect(win, configs);
  const currentProvider = String(Zotero.Prefs.get(`${config.addonRef}.apiProvider`) || configs[0]?.id || "");
  const currentConfig = configs.find((item) => item.id === currentProvider) || configs[0];
  if (currentConfig) {
    applyApiConfig(win, currentConfig);
  }

  const select = win.document.querySelector(
    `#zotero-prefpane-${config.addonRef}-api-provider`,
  ) as (HTMLSelectElement & { __pageIndexApiConfigBound?: boolean }) | null;
  if (select && !select.__pageIndexApiConfigBound) {
    select.__pageIndexApiConfigBound = true;
    select.addEventListener("change", () => {
      const apiConfig = getApiConfigs().find((item) => item.id === select.value);
      if (apiConfig) {
        applyApiConfig(win, apiConfig);
      }
    });
  }

  const addButton = win.document.querySelector(
    `#zotero-prefpane-${config.addonRef}-add-api-config`,
  ) as (HTMLButtonElement & { __pageIndexApiConfigBound?: boolean }) | null;
  if (addButton && !addButton.__pageIndexApiConfigBound) {
    addButton.__pageIndexApiConfigBound = true;
    addButton.addEventListener("click", () => {
      configs = getApiConfigs();
      const newConfig = promptApiConfig(
        win,
        {
          id: "api",
          name: "Custom API",
          api: "https://api.deepseek.com",
          secretKey: "",
          model: "deepseek-chat",
        },
        configs,
        true,
      );
      if (!newConfig) {
        return;
      }
      configs.push(newConfig);
      saveApiConfigs(configs);
      renderApiConfigSelect(win, configs);
      applyApiConfig(win, newConfig);
      setStatus(win, `zotero-prefpane-${config.addonRef}-api-config-status`, text.added(newConfig.name), "success");
    });
  }

  const editButton = win.document.querySelector(
    `#zotero-prefpane-${config.addonRef}-edit-api-config`,
  ) as (HTMLButtonElement & { __pageIndexApiConfigBound?: boolean }) | null;
  if (editButton && !editButton.__pageIndexApiConfigBound) {
    editButton.__pageIndexApiConfigBound = true;
    editButton.addEventListener("click", () => {
      configs = getApiConfigs();
      const selected = configs.find((item) => item.id === select?.value);
      if (!selected) {
        return;
      }
      const editedConfig = promptApiConfig(win, selected, configs);
      if (!editedConfig) {
        return;
      }
      configs = replaceApiConfig(configs, editedConfig);
      saveApiConfigs(configs);
      renderApiConfigSelect(win, configs);
      applyApiConfig(win, editedConfig);
      setStatus(win, `zotero-prefpane-${config.addonRef}-api-config-status`, text.updated(editedConfig.name), "success");
    });
  }

  const saveButton = win.document.querySelector(
    `#zotero-prefpane-${config.addonRef}-save-api-config`,
  ) as (HTMLButtonElement & { __pageIndexApiConfigBound?: boolean }) | null;
  if (saveButton && !saveButton.__pageIndexApiConfigBound) {
    saveButton.__pageIndexApiConfigBound = true;
    saveButton.addEventListener("click", () => {
      configs = getApiConfigs();
      const selected = configs.find((item) => item.id === select?.value);
      if (!selected) {
        return;
      }
      const nextConfig = getCurrentConfigFromInputs(win, selected);
      configs = replaceApiConfig(configs, nextConfig);
      saveApiConfigs(configs);
      renderApiConfigSelect(win, configs);
      applyApiConfig(win, nextConfig);
      setStatus(win, `zotero-prefpane-${config.addonRef}-api-config-status`, text.saved(nextConfig.name), "success");
    });
  }

  const duplicateButton = win.document.querySelector(
    `#zotero-prefpane-${config.addonRef}-duplicate-api-config`,
  ) as (HTMLButtonElement & { __pageIndexApiConfigBound?: boolean }) | null;
  if (duplicateButton && !duplicateButton.__pageIndexApiConfigBound) {
    duplicateButton.__pageIndexApiConfigBound = true;
    duplicateButton.addEventListener("click", () => {
      configs = getApiConfigs();
      const selected = configs.find((item) => item.id === select?.value);
      if (!selected) {
        return;
      }
      const name = win.prompt(text.newConfigNamePrompt, `${selected.name} ${text.copySuffix}`);
      if (!name) {
        return;
      }
      const copiedConfig = sanitizeApiConfig({
        ...getCurrentConfigFromInputs(win, selected),
        id: createConfigId(name, configs),
        name,
      });
      configs.push(copiedConfig);
      saveApiConfigs(configs);
      renderApiConfigSelect(win, configs);
      applyApiConfig(win, copiedConfig);
      setStatus(win, `zotero-prefpane-${config.addonRef}-api-config-status`, text.duplicated(copiedConfig.name), "success");
    });
  }

  const deleteButton = win.document.querySelector(
    `#zotero-prefpane-${config.addonRef}-delete-api-config`,
  ) as (HTMLButtonElement & { __pageIndexApiConfigBound?: boolean }) | null;
  if (deleteButton && !deleteButton.__pageIndexApiConfigBound) {
    deleteButton.__pageIndexApiConfigBound = true;
    deleteButton.addEventListener("click", () => {
      const selectedId = select?.value || "";
      if (isDefaultApiConfig(selectedId)) {
        setStatus(win, `zotero-prefpane-${config.addonRef}-api-config-status`, text.presetsCannotDelete, "fail");
        return;
      }
      configs = getApiConfigs();
      const selected = configs.find((item) => item.id === selectedId);
      if (!selected || !win.confirm(text.deleteConfirm(selected.name))) {
        return;
      }
      configs = configs.filter((item) => item.id !== selectedId);
      saveApiConfigs(configs);
      renderApiConfigSelect(win, configs);
      const nextConfig = configs[0] || DEFAULT_API_CONFIGS[0];
      applyApiConfig(win, nextConfig);
      setStatus(win, `zotero-prefpane-${config.addonRef}-api-config-status`, text.deleted(selected.name), "success");
    });
  }

  const restoreButton = win.document.querySelector(
    `#zotero-prefpane-${config.addonRef}-restore-api-defaults`,
  ) as (HTMLButtonElement & { __pageIndexApiConfigBound?: boolean }) | null;
  if (restoreButton && !restoreButton.__pageIndexApiConfigBound) {
    restoreButton.__pageIndexApiConfigBound = true;
    restoreButton.addEventListener("click", () => {
      configs = getApiConfigs().filter((item) => !isDefaultApiConfig(item.id));
      configs = [...DEFAULT_API_CONFIGS, ...configs];
      saveApiConfigs(configs);
      renderApiConfigSelect(win, configs);
      const currentId = select?.value || DEFAULT_API_CONFIGS[0].id;
      const nextConfig = configs.find((item) => item.id === currentId) || DEFAULT_API_CONFIGS[0];
      applyApiConfig(win, nextConfig);
      setStatus(win, `zotero-prefpane-${config.addonRef}-api-config-status`, text.defaultsRestored, "success");
    });
  }

  const testButton = win.document.querySelector(
    `#zotero-prefpane-${config.addonRef}-test-api-config`,
  ) as (HTMLButtonElement & { __pageIndexApiConfigBound?: boolean }) | null;
  if (testButton && !testButton.__pageIndexApiConfigBound) {
    testButton.__pageIndexApiConfigBound = true;
    testButton.addEventListener("click", () => {
      void testApiConfig(win);
    });
  }

  updateApiConfigButtons(win);
}

function bindPreferencePane(win: Window) {
  localizePreferencePane(win);
  win.document
    .querySelectorAll("[preference]")
    .forEach((element) => bindPreferenceControl(element));
  bindApiConfigControls(win);
  bindToggle(
    win,
    `zotero-prefpane-${config.addonRef}-toggle-advanced`,
    `zotero-prefpane-${config.addonRef}-advanced-settings`,
  );
  bindToggle(
    win,
    `zotero-prefpane-${config.addonRef}-toggle-page-index-advanced`,
    `zotero-prefpane-${config.addonRef}-page-index-advanced-settings`,
  );
}

async function onPrefsEvent(type: string, options?: { window?: Window }) {
  switch (type) {
    case "load":
      if (options?.window) {
        bindPreferencePane(options.window);
      }
      ztoolkit.log("preference pane loaded");
      return;
    default:
      return;
  }
}

async function onMainWindowUnload(win: Window) {
  initializedWindows.delete(win);
  win.document.querySelector(`#${config.addonRef}-open-window`)?.remove();
  win.document.querySelector(`#${config.addonRef}-style`)?.remove();
  win.document.querySelector(`#${config.addonRef}-link`)?.remove();
  win.document.querySelector("#zotero-GPT-container")?.remove();
}

function onShutdown(): void {
  if (
    addon.data.preferencePaneID &&
    Zotero.PreferencePanes &&
    typeof Zotero.PreferencePanes.unregister === "function"
  ) {
    Zotero.PreferencePanes.unregister(addon.data.preferencePaneID);
  }

  Zotero.getMainWindows?.().forEach((win) => {
    win.document.querySelector(`#${config.addonRef}-open-window`)?.remove();
    win.document.querySelector(`#${config.addonRef}-style`)?.remove();
    win.document.querySelector(`#${config.addonRef}-link`)?.remove();
    win.document.querySelector("#zotero-GPT-container")?.remove();
  });
  ztoolkit.unregisterAll();
  // Remove addon object
  addon.data.alive = false;
  delete Zotero[config.addonInstance];
}

export default {
  onStartup,
  onMainWindowLoad,
  onMainWindowUnload,
  onPrefsEvent,
  onShutdown,
};
