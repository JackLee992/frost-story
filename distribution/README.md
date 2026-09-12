# Distribution

`content-manifest.json` is the small mutable pointer consumed by the signed Android app.
Content archives and APKs are immutable GitHub Release assets and are intentionally not committed.

To publish future story, balance, art, audio, or game-code content, run the **Publish verified game content** workflow with a version newer than the current manifest. The app downloads and validates it in the background, then activates it on the next launch. Native Kotlin or permission changes still require a newly signed APK.
