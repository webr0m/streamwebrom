# Native audio component

Windows WASAPI implementation derived from CilginSinek/electron-native-screenshare,
commit 69f9b317f08aad4a83b8c8843b019d230907667d (MIT).

Upstream: https://github.com/CilginSinek/electron-native-screenshare

Only the Windows implementation is vendored. The original MIT notice accompanies
the sources and is included in desktop distributions. StreamWebRom changes bound
the callback queue, release rejected queued buffers, handle shutdown callbacks,
and make the capture-stop flag atomic. The renderer has no Node/native access;
the application main process authorizes each user-selected capture.
