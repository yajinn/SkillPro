// ─── Framework Detection ────────────────────────────────────────────
// Ported from detect.sh section 2: Framework Detection
// Per-language framework + sub-framework detection.
// ─────────────────────────────────────────────────────────────────────

import { join } from 'node:path';
import {
  pkgHas,
  pipHas,
  composerHas,
  pubHas,
  gemHas,
  nugetHas,
  fileExists,
  anyFileExists,
  fileContains,
  dirExists,
  hasNotebookFiles as checkNotebookFiles,
} from './manifest-readers.js';

export function detectFramework(
  dir: string,
  language: string,
): { framework: string | null; sub_framework: string | null } {
  let framework: string | null = null;
  let subFramework: string | null = null;

  switch (language) {
    case 'php':
      ({ framework, subFramework } = detectPhpFramework(dir));
      break;
    case 'python':
      ({ framework, subFramework } = detectPythonFramework(dir));
      break;
    case 'javascript':
    case 'typescript':
      ({ framework, subFramework } = detectJsFramework(dir));
      break;
    case 'go':
      ({ framework, subFramework } = detectGoFramework(dir));
      break;
    case 'rust':
      ({ framework, subFramework } = detectRustFramework(dir));
      break;
    case 'ruby':
      ({ framework, subFramework } = detectRubyFramework(dir));
      break;
    case 'java':
    case 'kotlin':
      ({ framework, subFramework } = detectJavaFramework(dir));
      break;
    case 'dart':
      ({ framework, subFramework } = detectDartFramework(dir));
      break;
    case 'csharp':
      ({ framework, subFramework } = detectCsharpFramework(dir));
      break;
  }

  return { framework, sub_framework: subFramework };
}

// ─── PHP ─────────────────────────────────────────────────────────────

function detectPhpFramework(dir: string) {
  let framework: string | null = null;
  let subFramework: string | null = null;

  if (fileExists(join(dir, 'wp-config.php')) || dirExists(dir, 'wp-content')) {
    framework = 'wordpress';
    const subs: string[] = [];
    if (dirExists(dir, 'wp-content/plugins/woocommerce') || composerHas(dir, 'woocommerce')) {
      subs.push('woocommerce');
    }
    if (dirExists(dir, 'wp-content/plugins/elementor')) {
      subs.push('elementor');
    }
    if (subs.length > 0) subFramework = subs.join(',');
  } else if (fileExists(join(dir, 'artisan'))) {
    framework = 'laravel';
    const subs: string[] = [];
    if (composerHas(dir, 'livewire')) subs.push('livewire');
    if (composerHas(dir, 'inertia')) subs.push('inertia');
    if (subs.length > 0) subFramework = subs.join(',');
  } else if (composerHas(dir, 'symfony/framework-bundle')) {
    framework = 'symfony';
  } else if (composerHas(dir, 'drupal/core')) {
    framework = 'drupal';
  }

  return { framework, subFramework };
}

// ─── Python ──────────────────────────────────────────────────────────

function detectPythonFramework(dir: string) {
  let framework: string | null = null;
  let subFramework: string | null = null;

  if (pipHas(dir, 'django') || fileExists(join(dir, 'manage.py'))) {
    framework = 'django';
    const subs: string[] = [];
    if (pipHas(dir, 'djangorestframework')) subs.push('drf');
    if (pipHas(dir, 'wagtail')) subs.push('wagtail');
    if (subs.length > 0) subFramework = subs.join(',');
  } else if (pipHas(dir, 'fastapi')) {
    framework = 'fastapi';
  } else if (pipHas(dir, 'flask')) {
    framework = 'flask';
  } else if (pipHas(dir, 'streamlit')) {
    framework = 'streamlit';
  } else if (
    pipHas(dir, 'jupyter') ||
    checkNotebookFiles(dir)
  ) {
    framework = 'jupyter';
  } else if (
    pipHas(dir, 'torch') ||
    pipHas(dir, 'tensorflow') ||
    pipHas(dir, 'transformers')
  ) {
    framework = 'ml-pipeline';
  }

  return { framework, subFramework };
}

// ─── JavaScript / TypeScript ─────────────────────────────────────────

function detectJsFramework(dir: string) {
  let framework: string | null = null;
  let subFramework: string | null = null;

  if (anyFileExists(dir, 'next.config.ts', 'next.config.js', 'next.config.mjs')) {
    framework = 'nextjs';
    if (
      dirExists(dir, 'app') &&
      anyFileExists(dir, 'app/layout.tsx', 'app/layout.jsx')
    ) {
      subFramework = 'app-router';
    } else if (dirExists(dir, 'pages')) {
      subFramework = 'pages-router';
    }
  } else if (
    fileExists(join(dir, 'react-native.config.js')) ||
    pkgHas(dir, '"react-native"')
  ) {
    framework = 'react-native';
    if (
      fileExists(join(dir, 'app.json')) &&
      fileContains(join(dir, 'app.json'), 'expo')
    ) {
      subFramework = 'expo';
    } else {
      subFramework = 'cli';
    }
  } else if (anyFileExists(dir, 'nuxt.config.ts', 'nuxt.config.js')) {
    framework = 'nuxtjs';
  } else if (anyFileExists(dir, 'astro.config.mjs', 'astro.config.ts')) {
    framework = 'astro';
  } else if (anyFileExists(dir, 'remix.config.js', 'remix.config.ts')) {
    framework = 'remix';
  } else if (anyFileExists(dir, 'svelte.config.js', 'svelte.config.ts')) {
    framework = 'sveltekit';
  } else if (anyFileExists(dir, 'angular.json', '.angular-cli.json')) {
    framework = 'angular';
  } else if (anyFileExists(dir, 'vue.config.js', 'vite.config.ts', 'vite.config.js')) {
    if (pkgHas(dir, '"vue"')) {
      framework = 'vue';
    } else {
      framework = 'vite';
    }
  } else if (pkgHas(dir, '"@nestjs/core"')) {
    framework = 'nestjs';
  } else if (pkgHas(dir, '"fastify"')) {
    framework = 'fastify';
  } else if (pkgHas(dir, '"express"')) {
    framework = 'express';
  } else if (pkgHas(dir, '"electron"')) {
    framework = 'electron';
  } else if (pkgHas(dir, '"tauri"')) {
    framework = 'tauri';
  }

  return { framework, subFramework };
}

// ─── Go ──────────────────────────────────────────────────────────────

function detectGoFramework(dir: string) {
  let framework: string | null = null;
  const subFramework: string | null = null;
  const goMod = join(dir, 'go.mod');

  if (fileContains(goMod, 'gin-gonic')) {
    framework = 'gin';
  } else if (fileContains(goMod, 'labstack/echo')) {
    framework = 'echo';
  } else if (fileContains(goMod, 'gofiber')) {
    framework = 'fiber';
  } else if (fileContains(goMod, 'cobra')) {
    framework = 'cobra-cli';
  }

  return { framework, subFramework };
}

// ─── Rust ────────────────────────────────────────────────────────────

function detectRustFramework(dir: string) {
  let framework: string | null = null;
  const subFramework: string | null = null;
  const cargo = join(dir, 'Cargo.toml');

  if (fileContains(cargo, 'actix-web')) {
    framework = 'actix';
  } else if (fileContains(cargo, 'axum')) {
    framework = 'axum';
  } else if (fileContains(cargo, 'tauri')) {
    framework = 'tauri';
  } else if (fileContains(cargo, 'clap')) {
    framework = 'clap-cli';
  }

  return { framework, subFramework };
}

// ─── Ruby ────────────────────────────────────────────────────────────

function detectRubyFramework(dir: string) {
  let framework: string | null = null;
  const subFramework: string | null = null;

  if (
    fileExists(join(dir, 'config/routes.rb')) ||
    fileExists(join(dir, 'bin/rails'))
  ) {
    framework = 'rails';
  } else if (
    fileExists(join(dir, 'config.ru')) &&
    fileContains(join(dir, 'Gemfile'), 'sinatra')
  ) {
    framework = 'sinatra';
  }

  return { framework, subFramework };
}

// ─── Java / Kotlin ───────────────────────────────────────────────────

function detectJavaFramework(dir: string) {
  let framework: string | null = null;
  const subFramework: string | null = null;

  if (
    fileContains(join(dir, 'pom.xml'), 'spring-boot') ||
    fileContains(join(dir, 'build.gradle'), 'org.springframework.boot')
  ) {
    framework = 'spring-boot';
  } else if (
    dirExists(dir, 'app/src/main/java') ||
    dirExists(dir, 'app/src/main/kotlin')
  ) {
    framework = 'android-native';
  }

  return { framework, subFramework };
}

// ─── Dart ────────────────────────────────────────────────────────────

function detectDartFramework(dir: string) {
  let framework: string | null = null;
  let subFramework: string | null = null;

  if (fileContains(join(dir, 'pubspec.yaml'), 'flutter')) {
    framework = 'flutter';
    const subs: string[] = [];
    if (pubHas(dir, 'flutter_redux') || pubHas(dir, 'redux')) subs.push('redux');
    if (pubHas(dir, 'flutter_bloc') || pubHas(dir, 'bloc')) subs.push('bloc');
    if (pubHas(dir, 'riverpod') || pubHas(dir, 'flutter_riverpod')) subs.push('riverpod');
    if (pubHas(dir, 'provider')) subs.push('provider');
    if (pubHas(dir, 'get_it') || pubHas(dir, 'getx')) subs.push('getx');
    if (subs.length > 0) subFramework = subs.join(',');
  }

  return { framework, subFramework };
}

// ─── C# ──────────────────────────────────────────────────────────────

function detectCsharpFramework(dir: string) {
  let framework: string | null = null;
  const subFramework: string | null = null;

  if (nugetHas(dir, 'Microsoft.AspNetCore')) {
    framework = 'aspnet';
  } else if (nugetHas(dir, 'Xamarin') || nugetHas(dir, 'MAUI')) {
    framework = 'maui';
  }

  return { framework, subFramework };
}
