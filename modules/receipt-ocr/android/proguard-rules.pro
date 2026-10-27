# Applied to the app's release build (R8). ML Kit creates its component registrars by reflection,
# from names in the merged manifest. R8 on AGP 9 no longer keeps their no-arg constructors, so no
# components get registered and recognition fails with a null `getClass()` (SharedPrefManager).
-keep class * implements com.google.firebase.components.ComponentRegistrar {
  <init>();
}
