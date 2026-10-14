/**
 * Independent Pi profiles.
 *
 * Layout (same shape as default ~/.pi/agent, overlay on default):
 *   ~/.pi/agent/profiles/<id>/
 *     profile.json     optional { name, description, model, thinkingLevel }
 *     SYSTEM.md        optional; replaces the system prompt when present
 *     skills/          unioned with default skills
 *     prompts/         unioned with default prompts
 *     themes/          unioned with default themes
 *     extensions/      unioned with ~/.pi/agent/extensions (loaded for this profile)
 *     settings.json    kept for the user / other tools (not loaded here)
 *     models.json      kept for the user / other tools (not loaded here)
 *     mcp.json         unioned with ~/.pi/agent/mcp.json (and .pi/mcp.json)
 *
 * Activation:
 *   pi --profile researcher
 *   /profile researcher     new session, then apply
 *   /profile                print current profile
 *   /profile default        new session, back to Default
 *
 * No --profile => Default. Last-used is not remembered across process restarts.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

type ProfileExtensionContext = ExtensionContext & {
	newSession: () => Promise<{ cancelled?: boolean } | undefined>;
};

const ACTIVE_STORE = Symbol.for("pi.profiles.activeId");
const STATUS_ID = "profile";
const RESERVED_DEFAULT = "default";

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export interface ProfileMeta {
	name?: string;
	description?: string;
	model?: string;
	thinkingLevel?: ThinkingLevel;
}

export interface ActiveProfile {
	id: string;
	dir: string;
	displayName: string;
	meta: ProfileMeta;
	systemPrompt?: string;
	skillDir?: string;
	promptDir?: string;
	themeDir?: string;
	extensionDir?: string;
}

type GlobalStore = typeof globalThis & {
	[ACTIVE_STORE]?: string;
};

function profilesRoot(): string {
	return join(getAgentDir(), "profiles");
}

function profileDir(id: string): string {
	return join(profilesRoot(), id);
}

function getStoredId(): string | undefined {
	const value = (globalThis as GlobalStore)[ACTIVE_STORE];
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function setStoredId(id: string): void {
	(globalThis as GlobalStore)[ACTIVE_STORE] = id;
}

function isSafeProfileId(id: string): boolean {
	return (
		id.length > 0 &&
		id !== RESERVED_DEFAULT &&
		id !== "." &&
		id !== ".." &&
		!id.startsWith(".") &&
		!id.includes("/") &&
		!id.includes("\\")
	);
}

function isThinkingLevel(value: string): value is ThinkingLevel {
	return (THINKING_LEVELS as readonly string[]).includes(value);
}

function listProfileIds(): string[] {
	const root = profilesRoot();
	if (!existsSync(root)) return [];
	try {
		return readdirSync(root, { withFileTypes: true })
			.filter((entry) => entry.isDirectory() && isSafeProfileId(entry.name))
			.map((entry) => entry.name)
			.sort();
	} catch {
		return [];
	}
}

function profileExists(id: string): boolean {
	if (!isSafeProfileId(id)) return false;
	const dir = profileDir(id);
	try {
		return existsSync(dir) && statSync(dir).isDirectory();
	} catch {
		return false;
	}
}

function readJsonObject(path: string): Record<string, unknown> | undefined {
	if (!existsSync(path)) return undefined;
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
	} catch {
		return undefined;
	}
	return undefined;
}

function trimmedField(raw: Record<string, unknown>, key: string): string | undefined {
	const value = raw[key];
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function thinkingLevelFromRaw(
	raw: Record<string, unknown>,
	path: string,
): { value?: ThinkingLevel; error?: string } {
	if (typeof raw.thinkingLevel !== "string") return {};
	if (!isThinkingLevel(raw.thinkingLevel)) {
		return { error: `Invalid thinkingLevel "${raw.thinkingLevel}" in ${path}` };
	}
	return { value: raw.thinkingLevel };
}

function loadMeta(dir: string): { meta: ProfileMeta; error?: string } {
	const path = join(dir, "profile.json");
	if (!existsSync(path)) return { meta: {} };
	const raw = readJsonObject(path);
	if (!raw) return { meta: {}, error: `Invalid JSON: ${path}` };

	const thinking = thinkingLevelFromRaw(raw, path);
	const meta: ProfileMeta = {
		name: trimmedField(raw, "name"),
		description: trimmedField(raw, "description"),
		model: trimmedField(raw, "model"),
		thinkingLevel: thinking.value,
	};
	if (thinking.error) return { meta, error: thinking.error };
	return { meta };
}

function readSystemPrompt(dir: string): string | undefined {
	const path = join(dir, "SYSTEM.md");
	if (!existsSync(path)) return undefined;
	try {
		const text = readFileSync(path, "utf-8");
		return text.trim() ? text : undefined;
	} catch {
		return undefined;
	}
}

function optionalDir(dir: string, name: string): string | undefined {
	const path = join(dir, name);
	try {
		if (existsSync(path) && statSync(path).isDirectory()) return path;
	} catch {
		return undefined;
	}
	return undefined;
}

function isExtensionFile(name: string): boolean {
	if (name.startsWith(".") || name.endsWith(".d.ts")) return false;
	return name.endsWith(".ts") || name.endsWith(".js");
}

function resolveHostSpecifier(spec: string): string | undefined {
	try {
		if (typeof import.meta.resolve === "function") {
			const resolved = import.meta.resolve(spec);
			return resolved.startsWith("file:") ? fileURLToPath(resolved) : resolved;
		}
	} catch {
		// fall through to createRequire
	}
	try {
		return createRequire(import.meta.url).resolve(spec);
	} catch {
		return undefined;
	}
}

function hostAliases(): Record<string, string> {
	const aliases: Record<string, string> = {};
	for (const spec of [
		"@earendil-works/pi-coding-agent",
		"@earendil-works/pi-agent-core",
		"@earendil-works/pi-tui",
		"@earendil-works/pi-ai",
		"typebox",
	]) {
		const resolved = resolveHostSpecifier(spec);
		if (resolved) aliases[spec] = resolved;
	}
	return aliases;
}

function resolveExtensionEntries(dir: string): string[] | undefined {
	const packageJsonPath = join(dir, "package.json");
	if (existsSync(packageJsonPath)) {
		const raw = readJsonObject(packageJsonPath);
		const manifest = raw?.pi;
		if (manifest && typeof manifest === "object" && !Array.isArray(manifest)) {
			const listed = (manifest as Record<string, unknown>).extensions;
			if (Array.isArray(listed)) {
				const entries = listed
					.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
					.map((item) => join(dir, item))
					.filter((item) => existsSync(item));
				if (entries.length > 0) return entries;
			}
		}
	}
	const indexTs = join(dir, "index.ts");
	if (existsSync(indexTs)) return [indexTs];
	const indexJs = join(dir, "index.js");
	if (existsSync(indexJs)) return [indexJs];
	return undefined;
}

/** Same discovery rules as Pi: files in the folder, one-level subdirs with index or pi.extensions. */
function discoverExtensionsInDir(dir: string): string[] {
	if (!existsSync(dir)) return [];
	const discovered: string[] = [];
	try {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const entryPath = join(dir, entry.name);
			if ((entry.isFile() || entry.isSymbolicLink()) && isExtensionFile(entry.name)) {
				discovered.push(entryPath);
				continue;
			}
			if (entry.isDirectory() || entry.isSymbolicLink()) {
				const nested = resolveExtensionEntries(entryPath);
				if (nested) discovered.push(...nested);
			}
		}
	} catch {
		return [];
	}
	return discovered;
}

async function importExtensionModule(filePath: string): Promise<{ default?: unknown }> {
	const jiti = createJiti(import.meta.url, {
		moduleCache: false,
		alias: hostAliases(),
	});
	return (await jiti.import(filePath)) as { default?: unknown };
}

async function loadProfileExtensions(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	profile: ActiveProfile,
): Promise<void> {
	const extensionDir = profile.extensionDir;
	if (!extensionDir) return;

	const paths = discoverExtensionsInDir(extensionDir);
	for (const filePath of paths) {
		try {
			const mod = await importExtensionModule(filePath);
			const factory = mod.default;
			if (typeof factory !== "function") {
				ctx.ui.notify(
					`Profile "${profile.id}": ${filePath} does not export a default factory`,
					"warning",
				);
				continue;
			}
			await (factory as (api: ExtensionAPI) => unknown)(pi);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			ctx.ui.notify(`Profile "${profile.id}": failed to load ${filePath}: ${message}`, "error");
		}
	}
}

function mcpNameKey(name: string): string {
	return name.replace(/-/g, "_");
}

function mcpServerNamesFromFile(path: string): Set<string> {
	const names = new Set<string>();
	const raw = readJsonObject(path);
	const servers = raw?.mcpServers;
	if (!servers || typeof servers !== "object" || Array.isArray(servers)) return names;
	for (const name of Object.keys(servers)) names.add(mcpNameKey(name));
	return names;
}

function defaultMcpNameKeys(cwd: string): Set<string> {
	const names = mcpServerNamesFromFile(join(getAgentDir(), "mcp.json"));
	for (const name of mcpServerNamesFromFile(join(cwd, ".pi", "mcp.json"))) {
		names.add(name);
	}
	return names;
}

function readProfileMcpServers(
	dir: string,
): { servers: Record<string, unknown>; error?: string } {
	const path = join(dir, "mcp.json");
	if (!existsSync(path)) return { servers: {} };
	const raw = readJsonObject(path);
	if (!raw) return { servers: {}, error: `Invalid JSON: ${path}` };
	if (raw.mcpServers === undefined) return { servers: {} };
	if (!raw.mcpServers || typeof raw.mcpServers !== "object" || Array.isArray(raw.mcpServers)) {
		return { servers: {}, error: `Invalid mcpServers in ${path}` };
	}
	return { servers: raw.mcpServers as Record<string, unknown> };
}

function loadProfileMcpServers(pi: ExtensionAPI, ctx: ExtensionContext, profile: ActiveProfile): void {
	const { servers, error } = readProfileMcpServers(profile.dir);
	if (error) {
		ctx.ui.notify(`Profile "${profile.id}": ${error}`, "error");
		return;
	}

	const taken = defaultMcpNameKeys(ctx.cwd);
	for (const [name, config] of Object.entries(servers)) {
		if (taken.has(mcpNameKey(name))) {
			ctx.ui.notify(
				`Profile "${profile.id}": MCP server "${name}" already exists in default mcp.json (kept)`,
				"warning",
			);
			continue;
		}
		try {
			pi.registerMcpServer(name, config as Parameters<ExtensionAPI["registerMcpServer"]>[1]);
			taken.add(mcpNameKey(name));
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			ctx.ui.notify(
				`Profile "${profile.id}": failed to register MCP server "${name}": ${message}`,
				"error",
			);
		}
	}
}

function loadProfile(id: string): { profile?: ActiveProfile; error?: string } {
	if (id === RESERVED_DEFAULT) return { profile: undefined };
	if (!isSafeProfileId(id)) return { error: `Invalid profile name "${id}"` };
	if (!profileExists(id)) return { error: `Profile "${id}" not found in ${profilesRoot()}` };

	const dir = profileDir(id);
	const { meta, error } = loadMeta(dir);
	return {
		error,
		profile: {
			id,
			dir,
			displayName: meta.name ?? id,
			meta,
			systemPrompt: readSystemPrompt(dir),
			skillDir: optionalDir(dir, "skills"),
			promptDir: optionalDir(dir, "prompts"),
			themeDir: optionalDir(dir, "themes"),
			extensionDir: optionalDir(dir, "extensions"),
		},
	};
}

function requestedId(pi: ExtensionAPI): string {
	const stored = getStoredId();
	if (stored) return stored;
	const flag = pi.getFlag("profile");
	if (typeof flag === "string" && flag.trim()) return flag.trim();
	return RESERVED_DEFAULT;
}

export function formatCurrent(profile: ActiveProfile | undefined): string {
	if (!profile) return "Default";
	return profile.displayName === profile.id ? profile.id : `${profile.displayName} (${profile.id})`;
}

function updateStatus(ctx: ExtensionContext, profile: ActiveProfile | undefined): void {
	if (!ctx.hasUI) return;
	ctx.ui.setStatus(STATUS_ID, ctx.ui.theme.fg("accent", `Profile: ${formatCurrent(profile)}`));
}

export function resolveProfileModel<T extends { provider: string; id: string }>(
	spec: string,
	models: readonly T[],
): { model: T } | { error: string } {
	const trimmed = spec.trim();
	if (!trimmed.includes("/") || trimmed.startsWith("/") || trimmed.endsWith("/")) {
		return { error: `model must be provider/id, got "${spec}"` };
	}
	const lower = trimmed.toLowerCase();
	const byRef = models.filter((model) => `${model.provider}/${model.id}`.toLowerCase() === lower);
	if (byRef.length === 1) {
		const model = byRef[0];
		if (model) return { model };
	}
	const byId = models.filter((model) => model.id.toLowerCase() === lower);
	if (byId.length === 1) {
		const model = byId[0];
		if (model) return { model };
	}
	return { error: `model ${spec} not found` };
}

async function applyMetadata(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	profile: ActiveProfile,
): Promise<void> {
	const { model: modelSpec, thinkingLevel } = profile.meta;
	if (modelSpec) {
		const found = resolveProfileModel(modelSpec, ctx.modelRegistry.getAvailable());
		if ("error" in found) {
			ctx.ui.notify(`Profile "${profile.id}": ${found.error}`, "warning");
		} else {
			const ok = await pi.setModel(found.model);
			if (!ok) {
				ctx.ui.notify(`Profile "${profile.id}": no API key for ${modelSpec}`, "warning");
			}
		}
	}
	if (thinkingLevel) {
		pi.setThinkingLevel(thinkingLevel);
	}
}

interface ProfileController {
	resolve: (ctx?: ExtensionContext) => { profile?: ActiveProfile; error?: string };
	current: (ctx?: ExtensionContext) => ActiveProfile | undefined;
	switchToDefault: (
		ctx: ProfileExtensionContext,
		profile: ActiveProfile | undefined,
	) => Promise<void>;
	switchToNamed: (
		ctx: ProfileExtensionContext,
		profile: ActiveProfile | undefined,
		name: string,
	) => Promise<void>;
}

async function switchToDefault(
	ctx: ProfileExtensionContext,
	profile: ActiveProfile | undefined,
): Promise<void> {
	if (!profile) {
		ctx.ui.notify("Already on Default", "info");
		return;
	}
	setStoredId(RESERVED_DEFAULT);
	const result = await ctx.newSession();
	if (result?.cancelled) {
		setStoredId(profile.id);
		ctx.ui.notify("Profile switch cancelled", "warning");
	}
}

async function switchToNamed(
	ctx: ProfileExtensionContext,
	profile: ActiveProfile | undefined,
	name: string,
): Promise<void> {
	const loaded = loadProfile(name);
	if (!loaded.profile) {
		ctx.ui.notify(loaded.error ?? `Profile "${name}" not found`, "error");
		return;
	}

	if (profile?.id === name) {
		ctx.ui.notify(`Already on profile ${formatCurrent(profile)}`, "info");
		return;
	}

	const previous = profile?.id ?? RESERVED_DEFAULT;
	setStoredId(name);
	const result = await ctx.newSession();
	if (result?.cancelled) {
		setStoredId(previous);
		ctx.ui.notify("Profile switch cancelled", "warning");
	}
}

function createProfileController(pi: ExtensionAPI): ProfileController {
	let active: ActiveProfile | undefined;
	let resolved = false;

	function resolve(ctx?: ExtensionContext): { profile?: ActiveProfile; error?: string } {
		const id = requestedId(pi);
		if (id === RESERVED_DEFAULT) {
			setStoredId(RESERVED_DEFAULT);
			active = undefined;
			resolved = true;
			return {};
		}
		const loaded = loadProfile(id);
		if (loaded.profile) {
			setStoredId(id);
			active = loaded.profile;
			resolved = true;
			return loaded;
		}
		setStoredId(RESERVED_DEFAULT);
		active = undefined;
		resolved = true;
		if (ctx?.hasUI && loaded.error) {
			ctx.ui.notify(loaded.error, "error");
		}
		return loaded;
	}

	function current(ctx?: ExtensionContext): ActiveProfile | undefined {
		if (!resolved) resolve(ctx);
		return active;
	}

	return { resolve, current, switchToDefault, switchToNamed };
}

function registerSessionHooks(pi: ExtensionAPI, controller: ProfileController): void {
	pi.on("session_start", async (_event, ctx) => {
		const { profile, error } = controller.resolve(ctx);
		updateStatus(ctx, profile);

		if (error && profile) {
			ctx.ui.notify(error, "warning");
		}

		if (!profile) return;

		await loadProfileExtensions(pi, ctx, profile);
		loadProfileMcpServers(pi, ctx, profile);
		await applyMetadata(pi, ctx, profile);
	});

	pi.on("resources_discover", () => {
		const profile = controller.current();
		if (!profile) return;
		return {
			skillPaths: profile.skillDir ? [profile.skillDir] : [],
			promptPaths: profile.promptDir ? [profile.promptDir] : [],
			themePaths: profile.themeDir ? [profile.themeDir] : [],
		};
	});

	pi.on("before_agent_start", () => {
		const prompt = controller.current()?.systemPrompt;
		if (!prompt) return;
		return { systemPrompt: prompt };
	});
}

function completionDescription(id: string): string {
	if (id === RESERVED_DEFAULT) return "Default ~/.pi/agent setup";
	return loadMeta(profileDir(id)).meta.description ?? "";
}

function registerProfileCommand(pi: ExtensionAPI, controller: ProfileController): void {
	pi.registerCommand("profile", {
		description: "Show or switch Pi profile (new session)",
		getArgumentCompletions: (prefix) => {
			const names = [RESERVED_DEFAULT, ...listProfileIds()];
			const items = names
				.filter((name) => name.startsWith(prefix))
				.map((name) => ({
					value: name,
					label: name,
					description: completionDescription(name),
				}));
			return items.length > 0 ? items : null;
		},
		handler: async (args, ctx) => {
			const name = args.trim().split(/\s+/)[0] ?? "";
			const profile = controller.current(ctx);

			if (!name) {
				ctx.ui.notify(`Current profile: ${formatCurrent(profile)}`, "info");
				return;
			}

			if (name === RESERVED_DEFAULT) {
				await controller.switchToDefault(ctx, profile);
				return;
			}

			await controller.switchToNamed(ctx, profile, name);
		},
	});
}

export default function (pi: ExtensionAPI) {
	pi.registerFlag("profile", {
		description: "Pi profile directory name under ~/.pi/agent/profiles",
		type: "string",
	});

	const controller = createProfileController(pi);
	registerSessionHooks(pi, controller);
	registerProfileCommand(pi, controller);
}
