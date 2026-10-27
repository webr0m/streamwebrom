{
  "targets": [{
    "target_name": "electron_native_screenshare",
    "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
    "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
    "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS", "_WIN32_WINNT=0x0A00", "NTDDI_VERSION=0x0A00000A"],
    "sources": ["src/win/addon.cpp", "src/win/wasapi_capture.cpp"],
    "libraries": ["-lMmdevapi.lib", "-lAvrt.lib"],
    "msvs_settings": { "VCCLCompilerTool": { "AdditionalOptions": ["/std:c++17"] } }
  }]
}
