(async function () {
  const appBasePath = detectAppBasePath(window.location.pathname);
  const ONBOARDING_PENDING_KEY = "mybishbash.onboarding-protected-app-setup-pending.v1";
  const NORMAL_APP_LAUNCHER = {
    id: "mybishbash",
    displayName: "myBishBash",
    name: "myBishBash",
    iconSrc: `${appBasePath}/icons/mybishbash-cover.png`,
    manifestPath: `${appBasePath}/manifest.webmanifest`,
    launchPath: "/home",
  };
  const registry = await loadRegistry(NORMAL_APP_LAUNCHER, appBasePath);
  const launcherId = resolveLauncherIdFromPath(window.location.pathname, registry, appBasePath);
  const launcher = registry.launchers.find((item) => item.id === launcherId) ?? fallbackFakeLauncher(launcherId, appBasePath) ?? NORMAL_APP_LAUNCHER;

  if (!launcher) return;

  const isStandalone =
    window.matchMedia?.("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;

  if (launcher.id !== "mybishbash" && launcher.launchPath) {
    storeInstalledLauncherShell(launcher);
  }

  const stored = loadStoredVersions();
  const storedLauncher = stored[launcher.id] || {};
  const version = { ...launcher, ...storedLauncher };
  const iconSrc = version.customIconSrc || version.iconSrc;

  document.title = version.id === "mybishbash" ? "myBishBash" : `${version.displayName || version.name} · myBishBash`;

  const appleTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]');
  if (appleTitle) appleTitle.setAttribute("content", version.displayName || version.name);

  const manifestLink = document.querySelector('link[rel="manifest"]');
  if (manifestLink) manifestLink.setAttribute("href", version.manifestPath);

  const touchIcon = document.querySelector('link[rel="apple-touch-icon"]');
  if (touchIcon) touchIcon.setAttribute("href", iconSrc);

  const iconImage = document.querySelector("[data-install-icon]");
  if (iconImage) {
    iconImage.src = iconSrc;
    iconImage.alt = `${version.displayName || version.name} icon`;
  }

  const launchLink = document.querySelector("[data-launch-link]");
  if (launchLink && version.launchPath) {
    const launchPayload = buildLauncherPayload({
      appBasePath,
      fakeAppId: version.id,
      launcher: version,
      previewNamespace: appBasePath.replace(/^\/+/, ""),
      source: "install_icon",
    });
    const launchUrl = new URL(`${window.location.origin}${appBasePath}${launchPayload.targetRoute}`);
    const currentParams = new URLSearchParams(window.location.search);
    if (currentParams.get("launcherAudit") === "1") {
      launchUrl.searchParams.set("launcherAudit", "1");
      window.localStorage.setItem("bishbash.launchAudit.enabled", "true");
    }
    launchLink.href = launchUrl.toString();
    launchLink.addEventListener("click", () => {
      logLauncherNavigation({
        ...launchPayload,
        currentPath: window.location.pathname,
        localStorageLauncherContext: readStorageValue("localStorage", "mybishbash.installed-launcher-shell.v1"),
        sessionStorageLauncherContext: readStorageValue("sessionStorage", "mybishbash.installed-launcher-shell.v1"),
      });
      if (launchPayload.appId !== "mybishbash") {
        storeInstalledLauncherShell(version);
      }
      const pendingEvents = loadPendingEvents();
      pendingEvents.push({
        event_type: "launcher_installed",
        launcher_id: launchPayload.appId,
        route: launchPayload.targetRoute,
        created_at: new Date().toISOString(),
        is_standalone: isStandalone,
        opened_from: launchPayload.source,
      });
      window.localStorage.setItem("mybishbash.pending-launcher-install.v1", JSON.stringify(pendingEvents.slice(-20)));
    });
  }

  const versionName = version.displayName || version.name;
  queryAll("[data-version-name], [data-version-name-inline]").forEach((node) => {
    node.textContent = versionName;
  });

  const launcherContext = document.querySelector("[data-launcher-context]");
  if (launcherContext) launcherContext.textContent = version.id;

  const settingsLink = document.querySelector("[data-settings-link]");
  if (settingsLink) settingsLink.href = `${window.location.origin}${appBasePath}/settings`;

  const backButton = document.querySelector("[data-install-back]");
  if (backButton) {
    backButton.addEventListener("click", () => {
      if (window.history.length > 1) {
        window.history.back();
        return;
      }
      window.location.assign(`${window.location.origin}${appBasePath}/onboarding`);
    });
  }

  const copySetupLinkButton = document.querySelector("[data-copy-setup-link]");
  const copySetupStatus = document.querySelector("[data-copy-setup-status]");
  if (copySetupLinkButton) {
    copySetupLinkButton.addEventListener("click", async () => {
      const setupUrl = buildSetupUrl({ appBasePath, launcherId: version.id });
      const copied = await copyTextToClipboard(setupUrl);
      if (copySetupStatus) {
        copySetupStatus.textContent = copied ? "Setup link copied." : setupUrl;
      }
    });
  }

  const completeButton = document.querySelector("[data-install-complete]");
  if (completeButton) {
    completeButton.addEventListener("click", () => {
      const existingPendingSetup = loadOnboardingPendingSetup(ONBOARDING_PENDING_KEY);
      if (version.id !== "mybishbash") {
        storeInstalledLauncherShell(version);
        if (existingPendingSetup?.appId === version.id) {
          window.localStorage.setItem(
            ONBOARDING_PENDING_KEY,
            JSON.stringify({
              appId: version.id,
              status: "confirmed",
              useInterruptionCard: Boolean(existingPendingSetup?.useInterruptionCard),
              updatedAt: new Date().toISOString(),
            }),
          );
        }
      }
      const pendingInstallEvents = loadPendingEvents();
      pendingInstallEvents.push({
        event_type: "launcher_installed",
        launcher_id: version.id,
        route: window.location.pathname,
        created_at: new Date().toISOString(),
        is_standalone: isStandalone,
        opened_from: "install_complete_button",
      });
      window.localStorage.setItem("mybishbash.pending-launcher-install.v1", JSON.stringify(pendingInstallEvents.slice(-20)));
      window.location.assign(resolveInstallCompleteUrl({ appBasePath, launcherId: version.id, pendingSetup: existingPendingSetup }));
    });
  }

  const pendingEvents = loadPendingEvents();
  pendingEvents.push(
    {
      event_type: "launcher_install_viewed",
      launcher_id: version.id,
      route: window.location.pathname,
      created_at: new Date().toISOString(),
      is_standalone: isStandalone,
    },
    {
      event_type: "launcher_manifest_loaded",
      launcher_id: version.id,
      route: version.manifestPath,
      created_at: new Date().toISOString(),
      is_standalone: isStandalone,
    },
  );
  window.localStorage.setItem(
    "mybishbash.pending-launcher-install.v1",
    JSON.stringify(pendingEvents.slice(-20)),
  );
})();

function detectAppBasePath(pathname) {
  const [firstPart] = String(pathname || "").split("/").filter(Boolean);
  if (firstPart === "mybishbash-preview") return "/mybishbash-preview";
  return "/mybishbash-preview";
}

function resolveLauncherIdFromPath(pathname, registry, appBasePath = "/mybishbash-preview") {
  const pathParts = String(pathname || "").split("/").filter(Boolean);
  const appBasePart = appBasePath.replace(/^\/+|\/+$/g, "");
  const installIndex = pathParts.indexOf("install");
  const candidate = installIndex >= 0
    ? pathParts[installIndex + 1]
    : pathParts[0] === appBasePart
      ? pathParts[1]
      : pathParts[0];
  return candidate || "mybishbash";
}

function buildLauncherPayload({ appBasePath = "/mybishbash-preview", previewNamespace = "", fakeAppId = "", launcher = {}, source = "install_icon" } = {}) {
  const appId = fakeAppId || launcher.id || "mybishbash";
  const targetRoute = launcher.launchPath || (appId === "mybishbash" ? "/home" : `/intercept/${appId}`);
  return {
    appId,
    launcherContext: appId,
    targetRoute,
    source,
    appBasePath,
    previewNamespace,
  };
}

function buildSetupUrl({ appBasePath = "/mybishbash-preview", launcherId = "instagram" } = {}) {
  const cleanBasePath = appBasePath || "/mybishbash-preview";
  const cleanLauncherId = launcherId || "instagram";
  return `${window.location.origin}${cleanBasePath}/install/${cleanLauncherId}/`;
}

async function copyTextToClipboard(text) {
  try {
    if (window.navigator?.clipboard?.writeText) {
      await window.navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy textarea copy path.
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    return copied;
  } catch {
    return false;
  }
}

function resolveInstallCompleteUrl({ appBasePath = "/mybishbash-preview", launcherId = "instagram", pendingSetup = null } = {}) {
  const cleanBasePath = appBasePath || "/mybishbash-preview";
  const cleanLauncherId = launcherId || "instagram";
  if (cleanLauncherId === "mybishbash") {
    return `${window.location.origin}${cleanBasePath}/home`;
  }
  if (pendingSetup?.appId === cleanLauncherId) {
    return `${window.location.origin}${cleanBasePath}/home?launcherInstalled=${encodeURIComponent(cleanLauncherId)}`;
  }
  return `${window.location.origin}${cleanBasePath}/apps/${encodeURIComponent(cleanLauncherId)}?installed=1`;
}

async function loadRegistry(normalAppLauncher, appBasePath = "/mybishbash-preview") {
  try {
    const response = await fetch(`${appBasePath}/launchers/registry.json`, { cache: "no-store" });
    if (response.ok) {
      const registry = await response.json();
      const fakeLaunchers = Array.isArray(registry.launchers) ? registry.launchers : [];
      return { launchers: [normalAppLauncher, ...fakeLaunchers.filter((item) => item.id !== normalAppLauncher.id)] };
    }
  } catch {
    // Fall through to a minimal hardcoded fallback so install pages still render offline.
  }

  return { launchers: [normalAppLauncher] };
}

function fallbackFakeLauncher(launcherId, appBasePath) {
  if (!launcherId || launcherId === "mybishbash") return null;
  const displayName = document.querySelector("[data-version-name]")?.textContent?.trim() || titleCaseLauncherId(launcherId);
  const iconSrc = document.querySelector("[data-install-icon]")?.getAttribute("src") || `${appBasePath}/icons/mybishbash-cover.png`;
  const manifestPath = document.querySelector('link[rel="manifest"]')?.getAttribute("href") || `${appBasePath}/launchers/${launcherId}/manifest.webmanifest`;
  return {
    id: launcherId,
    displayName,
    name: displayName,
    iconSrc,
    manifestPath,
    launchPath: `/intercept/${launcherId}`,
  };
}

function titleCaseLauncherId(launcherId) {
  return String(launcherId)
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function loadStoredVersions() {
  try {
    return JSON.parse(window.localStorage.getItem("mybishbash.home-screen-versions.v1") || "{}");
  } catch {
    return {};
  }
}

function loadPendingEvents() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem("mybishbash.pending-launcher-install.v1") || "[]");
    return Array.isArray(parsed) ? parsed : [parsed].filter(Boolean);
  } catch {
    return [];
  }
}

function loadOnboardingPendingSetup(key) {
  try {
    return JSON.parse(window.localStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}

function queryAll(selector) {
  if (typeof document.querySelectorAll === "function") {
    return Array.from(document.querySelectorAll(selector));
  }
  const node = document.querySelector?.(selector);
  return node ? [node] : [];
}

function storeInstalledLauncherShell(launcher) {
  window.localStorage.setItem(
    "mybishbash.installed-launcher-shell.v1",
    JSON.stringify({
      launcher_id: launcher.id,
      launch_path: launcher.launchPath,
      updated_at: new Date().toISOString(),
    }),
  );
}

function readStorageValue(storageName, key) {
  try {
    return window[storageName]?.getItem(key) || "";
  } catch {
    return "";
  }
}

function logLauncherNavigation(payload) {
  const message = {
    event_type: "launcher_navigation_resolved",
    ...payload,
  };
  window.__MYBISHBASH_LAUNCH_DEBUG__ = message;
  console.debug("[mybishbash-launcher]", message);
}
