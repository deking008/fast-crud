import { message, notification, Modal } from "ant-design-vue";
import { uiContext } from "@fast-crud/ui-interface";
import setupIcons from "./icons";
import { Antdv } from "./antdv";
export * from "./antdv";
import "./style.less";
export type UiSetupOptions = {
  setupIcons?: boolean;
};

export default {
  install(app: any, options: UiSetupOptions = {}) {
    const antdvUi = new Antdv({
      Message: message,
      Notification: notification,
      MessageBox: Modal
    });
    uiContext.set(antdvUi);

    if (options.setupIcons !== false) {
      setupIcons(app);
    }
    return antdvUi;
  }
};