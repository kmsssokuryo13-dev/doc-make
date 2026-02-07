import { APP_STATE_STORAGE_KEY } from './constants.js';

const WINDOW_NAME_STATE_PREFIX = "building_app_state_v1::";

export const isLocalStorageAvailable = () => {
  try {
    const k = "__ls_test__";
    window.localStorage.setItem(k, "1");
    window.localStorage.removeItem(k);
    return true;
  } catch (e) {
    return false;
  }
};

export const readStateFromWindowName = () => {
  try {
    const raw = window.name || "";
    if (!raw.startsWith(WINDOW_NAME_STATE_PREFIX)) return null;
    const json = raw.slice(WINDOW_NAME_STATE_PREFIX.length);
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
};

export const writeStateToWindowName = (payload) => {
  try {
    window.name = WINDOW_NAME_STATE_PREFIX + JSON.stringify(payload);
  } catch (e) {}
};
