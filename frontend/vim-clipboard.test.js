import { describe, expect, it, vi } from 'vitest';
import { installYankClipboardSync, syncSystemClipboardToUnnamedRegister, pasteFromSystemClipboard } from './vim-clipboard.js';

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

describe('syncSystemClipboardToUnnamedRegister', () => {
    it('loads native clipboard text into the unnamed register when available', async () => {
        const unnamedRegister = { setText: vi.fn() };
        const registerController = {
            getRegister: vi.fn(() => unnamedRegister),
            unnamedRegister,
        };
        const VimApi = { getRegisterController: () => registerController };
        const fetchImpl = vi.fn(async () => ({
            ok: true,
            json: async () => ({ text: 'native text' }),
        }));
        const clipboard = { readText: vi.fn(async () => 'web text') };

        await expect(syncSystemClipboardToUnnamedRegister(VimApi, { clipboard, fetchImpl })).resolves.toBe(true);
        expect(registerController.getRegister).toHaveBeenCalledWith('"');
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(clipboard.readText).not.toHaveBeenCalled();
        expect(unnamedRegister.setText).toHaveBeenCalledWith('native text', false, false);
    });

    it('falls back to web clipboard when native clipboard is unavailable', async () => {
        const unnamedRegister = { setText: vi.fn() };
        const registerController = {
            getRegister: vi.fn(() => unnamedRegister),
            unnamedRegister,
        };
        const VimApi = { getRegisterController: () => registerController };
        const fetchImpl = vi.fn(async () => ({ ok: false, json: async () => ({}) }));
        const clipboard = { readText: vi.fn(async () => 'web text') };

        await expect(syncSystemClipboardToUnnamedRegister(VimApi, { clipboard, fetchImpl })).resolves.toBe(true);
        expect(clipboard.readText).toHaveBeenCalledTimes(1);
        expect(unnamedRegister.setText).toHaveBeenCalledWith('web text', false, false);
    });

    it('falls back to web clipboard when native payload is malformed', async () => {
        const unnamedRegister = { setText: vi.fn() };
        const registerController = {
            getRegister: vi.fn(() => unnamedRegister),
            unnamedRegister,
        };
        const VimApi = { getRegisterController: () => registerController };
        const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
        const clipboard = { readText: vi.fn(async () => 'web text') };

        await expect(syncSystemClipboardToUnnamedRegister(VimApi, { clipboard, fetchImpl })).resolves.toBe(true);
        expect(clipboard.readText).toHaveBeenCalledTimes(1);
        expect(unnamedRegister.setText).toHaveBeenCalledWith('web text', false, false);
    });

    it('falls back to web clipboard when native fetch throws', async () => {
        const unnamedRegister = { setText: vi.fn() };
        const registerController = {
            getRegister: vi.fn(() => unnamedRegister),
            unnamedRegister,
        };
        const VimApi = { getRegisterController: () => registerController };
        const fetchImpl = vi.fn(async () => { throw new Error('network'); });
        const clipboard = { readText: vi.fn(async () => 'web text') };

        await expect(syncSystemClipboardToUnnamedRegister(VimApi, { clipboard, fetchImpl })).resolves.toBe(true);
        expect(clipboard.readText).toHaveBeenCalledTimes(1);
        expect(unnamedRegister.setText).toHaveBeenCalledWith('web text', false, false);
    });

    it('returns false when native and web clipboard reads fail', async () => {
        const unnamedRegister = { setText: vi.fn() };
        const registerController = {
            getRegister: vi.fn(() => unnamedRegister),
            unnamedRegister,
        };
        const VimApi = { getRegisterController: () => registerController };
        const fetchImpl = vi.fn(async () => ({ ok: false, json: async () => ({}) }));
        const clipboard = { readText: vi.fn(async () => { throw new Error('denied'); }) };

        await expect(syncSystemClipboardToUnnamedRegister(VimApi, { clipboard, fetchImpl })).resolves.toBe(false);
        expect(unnamedRegister.setText).not.toHaveBeenCalled();
    });

    it('returns false when register controller is unavailable', async () => {
        const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ text: 'native text' }) }));
        await expect(syncSystemClipboardToUnnamedRegister({}, { fetchImpl })).resolves.toBe(false);
    });

    it('returns false when clipboard api is unavailable', async () => {
        const unnamedRegister = { setText: vi.fn() };
        const registerController = {
            getRegister: vi.fn(() => unnamedRegister),
            unnamedRegister,
        };
        const VimApi = { getRegisterController: () => registerController };
        const fetchImpl = vi.fn(async () => ({ ok: false, json: async () => ({}) }));
        await expect(syncSystemClipboardToUnnamedRegister(VimApi, { clipboard: null, fetchImpl })).resolves.toBe(false);
        expect(unnamedRegister.setText).not.toHaveBeenCalled();
    });
});

describe('pasteFromSystemClipboard', () => {
    it('syncs clipboard then dispatches a Vim paste key', async () => {
        const unnamedRegister = { setText: vi.fn() };
        const VimApi = {
            getRegisterController: () => ({
                getRegister: () => unnamedRegister,
                unnamedRegister,
            }),
            handleKey: vi.fn(),
        };
        const clipboard = { readText: vi.fn(async () => 'clip text') };
        const cm = { state: { vim: { insertMode: false } } };

        const fetchImpl = vi.fn(async () => ({ ok: false, json: async () => ({}) }));

        await expect(pasteFromSystemClipboard(VimApi, cm, 'p', { clipboard, fetchImpl })).resolves.toBe(true);
        expect(unnamedRegister.setText).toHaveBeenCalledWith('clip text', false, false);
        expect(VimApi.handleKey).toHaveBeenCalledWith(cm, 'p', 'user');
    });

    it('uses native clipboard for paste when available', async () => {
        const unnamedRegister = { setText: vi.fn() };
        const VimApi = {
            getRegisterController: () => ({
                getRegister: () => unnamedRegister,
                unnamedRegister,
            }),
            handleKey: vi.fn(),
        };
        const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ text: 'native text' }) }));
        const clipboard = { readText: vi.fn(async () => 'web text') };
        const cm = {};

        await expect(pasteFromSystemClipboard(VimApi, cm, 'p', { clipboard, fetchImpl })).resolves.toBe(true);
        expect(clipboard.readText).not.toHaveBeenCalled();
        expect(unnamedRegister.setText).toHaveBeenCalledWith('native text', false, false);
        expect(VimApi.handleKey).toHaveBeenCalledWith(cm, 'p', 'user');
    });

    it('still dispatches paste when clipboard read fails', async () => {
        const unnamedRegister = { setText: vi.fn() };
        const VimApi = {
            getRegisterController: () => ({
                getRegister: () => unnamedRegister,
                unnamedRegister,
            }),
            handleKey: vi.fn(),
        };
        const clipboard = { readText: vi.fn(async () => { throw new Error('denied'); }) };
        const cm = {};

        const fetchImpl = vi.fn(async () => ({ ok: false, json: async () => ({}) }));

        await expect(pasteFromSystemClipboard(VimApi, cm, 'P', { clipboard, fetchImpl })).resolves.toBe(true);
        expect(unnamedRegister.setText).not.toHaveBeenCalled();
        expect(VimApi.handleKey).toHaveBeenCalledWith(cm, 'P', 'user');
    });

    it('returns false for unsupported keys', async () => {
        const VimApi = { handleKey: vi.fn() };
        const cm = {};

        await expect(pasteFromSystemClipboard(VimApi, cm, 'x')).resolves.toBe(false);
        expect(VimApi.handleKey).not.toHaveBeenCalled();
    });
});
