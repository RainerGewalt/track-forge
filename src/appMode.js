// Where this copy of Track Forge runs, decided when it is built:
//
//   'demo'   a build without the source service (VITE_SOURCE_SERVICE=off),
//            such as the hosted demo on GitHub Pages: drafts play in the
//            browser and nothing is saved;
//   'dev'    the Vite dev server: the tracks are local files, but the source
//            service is not part of it, so drafts are not saved either;
//   'local'  the LAN player build, which asks the source service at api/.
//
// VITE_SOURCE_SERVICE=on turns a dev server into 'local'.

export function appModeFor(env = {}) {
  const setting = env.VITE_SOURCE_SERVICE;

  if (setting) {
    return setting === 'off' ? 'demo' : 'local';
  }

  return env.DEV ? 'dev' : 'local';
}

export const APP_MODE = appModeFor(import.meta.env ?? {});

export const DEMO_NOTICE = {
  studio: 'Demo: drafts play in your browser; nothing is saved.',
  player: 'Demo: tracks play in your browser; nothing is saved.',
};

// What the Source Inspector says when it opens. sourceApi is the result of
// hydratePieceSources: { available, writeEnabled }.
export function inspectorOpenMessage(mode, sourceApi) {
  if (mode === 'demo') {
    return 'Demo: Try Draft plays your edit in this browser only. Nothing is saved; use Copy to keep it.';
  }

  if (mode === 'dev') {
    return 'Dev server: Try Draft plays your edit in this browser. Saving to files needs the LAN player with its source service (./setup.sh).';
  }

  if (!sourceApi.available) {
    return 'Draft playback is available. The source service is not reachable, so disk writes are off.';
  }

  if (!sourceApi.writeEnabled) {
    return 'Draft playback is available. Permanent writes need a SOURCE_EDITOR_TOKEN on the server.';
  }

  return 'Disk source loaded. Edit, then try the draft before overwriting.';
}

// What the Source Inspector says after a draft played successfully.
export function draftPlayingMessage(mode, canPrepare) {
  if (canPrepare) {
    return 'Draft is playing. Disk source unchanged. You can now prepare the overwrite.';
  }

  if (mode === 'demo') {
    return 'Draft is playing in this browser. The demo saves nothing; use Copy to keep it.';
  }

  if (mode === 'dev') {
    return 'Draft is playing in this browser. The dev server does not save drafts.';
  }

  return 'Draft is playing. Disk source unchanged; permanent writing is not configured.';
}
