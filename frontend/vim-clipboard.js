export function installYankClipboardSync(VimApi, clipboard = globalThis.navigator?.clipboard) {
    const registerController = VimApi?.getRegisterController?.();
    if (!registerController || registerController._yankClipboardSyncInstalled) {
        return false;
    }

    const originalPushText = registerController.pushText?.bind(registerController);
    if (typeof originalPushText !== 'function') {
        return false;
    }

    registerController.pushText = (registerName, operator, text, linewise, blockwise) => {
        originalPushText(registerName, operator, text, linewise, blockwise);
        if (operator !== 'yank' || registerName === '_') return;
        if (typeof text !== 'string') return;
        if (!clipboard || typeof clipboard.writeText !== 'function') return;
        clipboard.writeText(text).catch(() => {});
    };

    registerController._yankClipboardSyncInstalled = true;
    return true;
}

async function readNativeClipboard(fetchImpl = globalThis.fetch) {
    if (typeof fetchImpl !== 'function') {
        return null;
    }

    try {
        const response = await fetchImpl('/api/native-clipboard');
        if (!response.ok) {
            return null;
        }
        const payload = await response.json();
        return typeof payload?.text === 'string' ? payload.text : null;
    } catch {
        return null;
    }
}

export async function syncSystemClipboardToUnnamedRegister(
    VimApi,
    { clipboard = globalThis.navigator?.clipboard, fetchImpl = globalThis.fetch } = {},
) {
    const registerController = VimApi?.getRegisterController?.();
    if (!registerController) {
        return false;
    }

    const unnamedRegister = registerController.getRegister?.('"') || registerController.unnamedRegister;
    if (!unnamedRegister || typeof unnamedRegister.setText !== 'function') {
        return false;
    }

    const nativeText = await readNativeClipboard(fetchImpl);
    if (typeof nativeText === 'string') {
        unnamedRegister.setText(nativeText, false, false);
        return true;
    }

    if (!clipboard || typeof clipboard.readText !== 'function') {
        return false;
    }

    try {
        const text = await clipboard.readText();
        if (typeof text !== 'string') return false;
        unnamedRegister.setText(text, false, false);
        return true;
    } catch {
        return false;
    }
}

export async function pasteFromSystemClipboard(
    VimApi,
    cm,
    key,
    { clipboard = globalThis.navigator?.clipboard, fetchImpl = globalThis.fetch } = {},
) {
    if (key !== 'p' && key !== 'P') {
        return false;
    }
    if (!VimApi || typeof VimApi.handleKey !== 'function') {
        return false;
    }

    await syncSystemClipboardToUnnamedRegister(VimApi, { clipboard, fetchImpl });
    VimApi.handleKey(cm, key, 'user');
    return true;
}
