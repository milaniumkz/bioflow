import 'package:flutter/material.dart';

/// Collection palette with the user-approved Apache-licensed Open Sans.
abstract final class CollectionDesign {
  static const background = Color(0xfff5f6f2);
  static const paper = Colors.white;
  static const ink = Color(0xff172b25);
  static const muted = Color(0xff586b61);
  static const line = Color(0xffe3e9e2);
  static const controlLine = Color(0xff7c8d83);
  static const green = Color(0xff124d3e);
  static const accent = Color(0xff007d61);
  static const mint = Color(0xff53d9c4);
  static const soft = Color(0xffe5f4ed);
  static const error = Color(0xffac3f37);

  static ThemeData theme() {
    final base = ThemeData(
        useMaterial3: true,
        fontFamily: 'Open Sans',
        brightness: Brightness.light,
        colorScheme: const ColorScheme.light(
            primary: green,
            secondary: accent,
            surface: paper,
            onSurface: ink,
            onPrimary: Colors.white,
            error: error),
        scaffoldBackgroundColor: background,
        visualDensity: VisualDensity.standard);
    return base.copyWith(
        appBarTheme: const AppBarTheme(
            backgroundColor: paper,
            foregroundColor: ink,
            surfaceTintColor: Colors.transparent,
            elevation: 0,
            titleTextStyle: TextStyle(
                fontFamily: 'Open Sans',
                color: ink,
                fontSize: 18,
                fontWeight: FontWeight.w600)),
        cardTheme: CardThemeData(
            color: paper,
            surfaceTintColor: Colors.transparent,
            elevation: 0,
            margin: const EdgeInsets.symmetric(vertical: 8),
            shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(15),
                side: const BorderSide(color: line))),
        inputDecorationTheme: InputDecorationTheme(
            filled: true,
            fillColor: paper,
            contentPadding:
                const EdgeInsets.symmetric(horizontal: 14, vertical: 15),
            labelStyle: const TextStyle(color: muted),
            border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(10),
                borderSide: const BorderSide(color: controlLine)),
            enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(10),
                borderSide: const BorderSide(color: controlLine)),
            focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(10),
                borderSide: const BorderSide(color: accent, width: 2))),
        filledButtonTheme: FilledButtonThemeData(
            style: FilledButton.styleFrom(
                minimumSize: const Size(48, 48),
                padding:
                    const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(11)),
                textStyle: const TextStyle(
                    fontFamily: 'Open Sans',
                    fontSize: 14,
                    fontWeight: FontWeight.w600))),
        outlinedButtonTheme: OutlinedButtonThemeData(
            style: OutlinedButton.styleFrom(
                minimumSize: const Size(48, 48),
                side: const BorderSide(color: controlLine),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(11)))),
        navigationBarTheme: NavigationBarThemeData(
            backgroundColor: paper,
            surfaceTintColor: Colors.transparent,
            indicatorColor: soft,
            height: 80,
            labelTextStyle: WidgetStateProperty.resolveWith((states) =>
                TextStyle(
                    color:
                        states.contains(WidgetState.selected) ? green : muted,
                    fontSize: 12,
                    fontWeight: FontWeight.w600))),
        dividerTheme: const DividerThemeData(color: line, thickness: 1));
  }
}

class CollectionBrand extends StatelessWidget {
  const CollectionBrand({super.key, this.compact = false});
  final bool compact;
  @override
  Widget build(BuildContext context) =>
      Row(mainAxisSize: MainAxisSize.min, children: [
        Image.asset('assets/branding/collection-symbol.png',
            width: compact ? 34 : 50,
            height: compact ? 38 : 56,
            excludeFromSemantics: true),
        const SizedBox(width: 10),
        Flexible(
            child: Text('collection',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                    color: CollectionDesign.ink,
                    fontSize: compact ? 26 : 34,
                    fontWeight: FontWeight.w600,
                    letterSpacing: -1.3))),
      ]);
}
