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

export function installSystemClipboardPasteBindings(VimApi) {
    if (!VimApi || VimApi._systemClipboardPasteBindingsInstalled) {
        return false;
    }

    // Use non-recursive mappings so `p -> "+p` doesn't loop.
    VimApi.noremap('p', '"+p', 'normal');
    VimApi.noremap('P', '"+P', 'normal');
    VimApi.noremap('p', '"+p', 'visual');
    VimApi.noremap('P', '"+P', 'visual');
    VimApi._systemClipboardPasteBindingsInstalled = true;
    return true;
}
