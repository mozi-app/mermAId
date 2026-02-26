import { describe, expect, it, vi } from 'vitest';
import { installYankClipboardSync, installSystemClipboardPasteBindings } from './vim-clipboard.js';

describe('installYankClipboardSync', () => {
    it('wraps pushText and mirrors yanks to clipboard', () => {
        const originalPushText = vi.fn();
        const registerController = { pushText: originalPushText };
        const clipboard = { writeText: vi.fn(() => Promise.resolve()) };
        const VimApi = { getRegisterController: () => registerController };

        expect(installYankClipboardSync(VimApi, clipboard)).toBe(true);
        registerController.pushText('"', 'yank', 'hello world', true, false);

        expect(originalPushText).toHaveBeenCalledWith('"', 'yank', 'hello world', true, false);
        expect(clipboard.writeText).toHaveBeenCalledWith('hello world');
        expect(registerController._yankClipboardSyncInstalled).toBe(true);
    });

    it('does not copy for non-yank operators', () => {
        const originalPushText = vi.fn();
        const registerController = { pushText: originalPushText };
        const clipboard = { writeText: vi.fn(() => Promise.resolve()) };
        const VimApi = { getRegisterController: () => registerController };

        installYankClipboardSync(VimApi, clipboard);
        registerController.pushText('"', 'delete', 'text', false, false);

        expect(clipboard.writeText).not.toHaveBeenCalled();
    });

    it('does not copy for the black-hole register', () => {
        const originalPushText = vi.fn();
        const registerController = { pushText: originalPushText };
        const clipboard = { writeText: vi.fn(() => Promise.resolve()) };
        const VimApi = { getRegisterController: () => registerController };

        installYankClipboardSync(VimApi, clipboard);
        registerController.pushText('_', 'yank', 'text', false, false);

        expect(clipboard.writeText).not.toHaveBeenCalled();
    });

    it('is idempotent when installed multiple times', () => {
        const originalPushText = vi.fn();
        const registerController = { pushText: originalPushText };
        const clipboard = { writeText: vi.fn(() => Promise.resolve()) };
        const VimApi = { getRegisterController: () => registerController };

        expect(installYankClipboardSync(VimApi, clipboard)).toBe(true);
        expect(installYankClipboardSync(VimApi, clipboard)).toBe(false);

        registerController.pushText('"', 'yank', 'text', false, false);
        expect(originalPushText).toHaveBeenCalledTimes(1);
        expect(clipboard.writeText).toHaveBeenCalledTimes(1);
    });

    it('swallows clipboard write failures', async () => {
        const originalPushText = vi.fn();
        const registerController = { pushText: originalPushText };
        const clipboard = { writeText: vi.fn(() => Promise.reject(new Error('denied'))) };
        const VimApi = { getRegisterController: () => registerController };

        installYankClipboardSync(VimApi, clipboard);
        expect(() => registerController.pushText('"', 'yank', 'text', false, false)).not.toThrow();
        await Promise.resolve();

        expect(clipboard.writeText).toHaveBeenCalledWith('text');
    });
});

describe('installSystemClipboardPasteBindings', () => {
    it('maps p/P in normal and visual mode to the + register', () => {
        const VimApi = { noremap: vi.fn() };

        expect(installSystemClipboardPasteBindings(VimApi)).toBe(true);
        expect(VimApi.noremap.mock.calls).toEqual([
            ['p', '"+p', 'normal'],
            ['P', '"+P', 'normal'],
            ['p', '"+p', 'visual'],
            ['P', '"+P', 'visual'],
        ]);
        expect(VimApi._systemClipboardPasteBindingsInstalled).toBe(true);
    });

    it('is idempotent when installed multiple times', () => {
        const VimApi = { noremap: vi.fn() };

        expect(installSystemClipboardPasteBindings(VimApi)).toBe(true);
        expect(installSystemClipboardPasteBindings(VimApi)).toBe(false);
        expect(VimApi.noremap).toHaveBeenCalledTimes(4);
    });
});
