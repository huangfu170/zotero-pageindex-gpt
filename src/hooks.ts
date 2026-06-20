import { config } from "../package.json";
import { getString, initLocale } from "./modules/locale";
import Views from "./modules/views";
import Utils from "./modules/utils";
import { initValidation } from "./validation/core";

function registerToolsMenu() {
  const menuId = `${config.addonRef}-open-window`;
  document.querySelector(`#${menuId}`)?.remove();
  const menuPopup = document.querySelector("#menu_ToolsPopup");
  if (!menuPopup) {
    ztoolkit.log("Tools menu popup not found");
    return;
  }
  const menuItem = (document as any).createXULElement("menuitem");
  menuItem.id = menuId;
  menuItem.setAttribute("label", config.addonName);
  menuItem.setAttribute("class", "menuitem-iconic");
  menuItem.setAttribute("image", `chrome://${config.addonRef}/content/icons/favicon.png`);
  menuItem.addEventListener("command", () => {
    Zotero[config.addonInstance].views.show();
  });
  menuPopup.appendChild(menuItem);
}

async function onStartup() {
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

  Zotero[config.addonInstance].views = new Views();

  Zotero[config.addonInstance].utils = new Utils();

  try {
    registerToolsMenu();
  } catch (error) {
    ztoolkit.log("Failed to register tools menu", error);
  }
  ztoolkit.log(`${config.addonName} startup completed`);
}

function onShutdown(): void {
  document.querySelector(`#${config.addonRef}-open-window`)?.remove();
  ztoolkit.unregisterAll();
  // Remove addon object
  addon.data.alive = false;
  delete Zotero[config.addonInstance];
}

export default {
  onStartup,
  onShutdown,
};
