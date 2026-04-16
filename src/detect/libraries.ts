// ─── Library Introspection ──────────────────────────────────────────
// Ported from detect.sh section 8.5: Deep Library Introspection
// ~120 library mappings across 10 languages.
// ─────────────────────────────────────────────────────────────────────

import {
  pkgHas,
  pipHas,
  composerHas,
  gemHas,
  goModHas,
  cargoHas,
  pubHas,
  gradleHas,
  nugetHas,
} from './manifest-readers.js';

/**
 * Detect which specific libraries the project uses.
 * Returns a sorted, deduplicated array of canonical kebab-case IDs.
 */
export function detectLibraries(dir: string, language: string): string[] {
  const libs = new Set<string>();

  switch (language) {
    case 'javascript':
    case 'typescript':
      detectJsLibs(dir, libs);
      break;
    case 'python':
      detectPyLibs(dir, libs);
      break;
    case 'php':
      detectPhpLibs(dir, libs);
      break;
    case 'ruby':
      detectRubyLibs(dir, libs);
      break;
    case 'go':
      detectGoLibs(dir, libs);
      break;
    case 'rust':
      detectRustLibs(dir, libs);
      break;
    case 'dart':
      detectDartLibs(dir, libs);
      break;
    case 'java':
    case 'kotlin':
      detectJavaLibs(dir, libs);
      break;
    case 'csharp':
      detectCsharpLibs(dir, libs);
      break;
  }

  return Array.from(libs).sort();
}

// ─── JavaScript / TypeScript (~27) ───────────────────────────────────

function detectJsLibs(dir: string, libs: Set<string>): void {
  if (pkgHas(dir, '"@anthropic-ai/sdk"')) libs.add('anthropic-sdk');
  if (pkgHas(dir, '"@clerk/')) libs.add('clerk');
  if (pkgHas(dir, '"cypress"')) libs.add('cypress');
  if (pkgHas(dir, '"drizzle-orm"')) libs.add('drizzle');
  if (pkgHas(dir, '"framer-motion"')) libs.add('framer-motion');
  if (pkgHas(dir, '"jest"')) libs.add('jest');
  if (pkgHas(dir, '"jotai"')) libs.add('jotai');
  if (pkgHas(dir, '"kysely"')) libs.add('kysely');
  if (pkgHas(dir, '"langchain"')) libs.add('langchain');
  if (pkgHas(dir, '"mongoose"')) libs.add('mongoose');
  if (pkgHas(dir, '"next-auth"')) libs.add('next-auth');
  if (pkgHas(dir, '"openai"')) libs.add('openai-sdk');
  if (pkgHas(dir, '"playwright"') || pkgHas(dir, '"@playwright/test"')) libs.add('playwright');
  if (pkgHas(dir, '"@prisma/client"')) libs.add('prisma');
  if (pkgHas(dir, '"react-hook-form"')) libs.add('react-hook-form');
  if (pkgHas(dir, '"recoil"')) libs.add('recoil');
  if (pkgHas(dir, '"@reduxjs/toolkit"')) libs.add('redux-toolkit');
  if (pkgHas(dir, '"socket.io"')) libs.add('socketio');
  if (pkgHas(dir, '"stripe"') || pkgHas(dir, '"@stripe/stripe-js"')) libs.add('stripe');
  if (pkgHas(dir, '"@supabase/supabase-js"')) libs.add('supabase');
  if (pkgHas(dir, '"swr"')) libs.add('swr');
  if (pkgHas(dir, '"tailwindcss"')) libs.add('tailwindcss');
  if (pkgHas(dir, '"@tanstack/react-query"') || pkgHas(dir, '"@tanstack/query-core"')) libs.add('tanstack-query');
  if (pkgHas(dir, '"@trpc/')) libs.add('trpc');
  if (pkgHas(dir, '"typeorm"')) libs.add('typeorm');
  if (pkgHas(dir, '"vitest"')) libs.add('vitest');
  if (pkgHas(dir, '"yup"')) libs.add('yup');
  if (pkgHas(dir, '"zod"')) libs.add('zod');
  if (pkgHas(dir, '"zustand"')) libs.add('zustand');
}

// ─── Python (~23) ────────────────────────────────────────────────────

function detectPyLibs(dir: string, libs: Set<string>): void {
  if (pipHas(dir, 'alembic')) libs.add('alembic');
  if (pipHas(dir, 'anthropic')) libs.add('anthropic-sdk');
  if (pipHas(dir, 'boto3')) libs.add('boto3');
  if (pipHas(dir, 'celery')) libs.add('celery');
  if (pipHas(dir, 'fastapi')) libs.add('fastapi');
  if (pipHas(dir, 'gunicorn')) libs.add('gunicorn');
  if (pipHas(dir, 'httpx')) libs.add('httpx');
  if (pipHas(dir, 'langchain')) libs.add('langchain');
  if (pipHas(dir, 'mypy')) libs.add('mypy');
  if (pipHas(dir, 'numpy')) libs.add('numpy');
  if (pipHas(dir, 'openai')) libs.add('openai-sdk');
  if (pipHas(dir, 'pandas')) libs.add('pandas');
  if (pipHas(dir, 'polars')) libs.add('polars');
  if (pipHas(dir, 'pydantic')) libs.add('pydantic');
  if (pipHas(dir, 'pytest')) libs.add('pytest');
  if (pipHas(dir, 'redis')) libs.add('redis-py');
  if (pipHas(dir, 'ruff')) libs.add('ruff');
  if (pipHas(dir, 'scikit-learn')) libs.add('scikit-learn');
  if (pipHas(dir, 'sqlalchemy')) libs.add('sqlalchemy');
  if (pipHas(dir, 'stripe')) libs.add('stripe');
  if (pipHas(dir, 'tensorflow')) libs.add('tensorflow');
  if (pipHas(dir, 'torch')) libs.add('pytorch');
  if (pipHas(dir, 'transformers')) libs.add('transformers');
  if (pipHas(dir, 'uvicorn')) libs.add('uvicorn');
}

// ─── PHP (~12) ───────────────────────────────────────────────────────

function detectPhpLibs(dir: string, libs: Set<string>): void {
  if (composerHas(dir, 'doctrine/orm')) libs.add('doctrine-orm');
  if (composerHas(dir, 'filament/filament')) libs.add('filament');
  if (composerHas(dir, 'inertiajs/inertia-laravel')) libs.add('inertia');
  if (composerHas(dir, 'laravel/passport')) libs.add('laravel-passport');
  if (composerHas(dir, 'laravel/sanctum')) libs.add('laravel-sanctum');
  if (composerHas(dir, 'livewire/livewire')) libs.add('livewire');
  if (composerHas(dir, 'nesbot/carbon')) libs.add('carbon');
  if (composerHas(dir, 'pestphp/pest')) libs.add('pest');
  if (composerHas(dir, 'phpunit/phpunit')) libs.add('phpunit');
  if (composerHas(dir, 'spatie/laravel-permission')) libs.add('spatie-permission');
  if (composerHas(dir, 'stripe/stripe-php')) libs.add('stripe');
  if (composerHas(dir, 'symfony/messenger')) libs.add('symfony-messenger');
}

// ─── Ruby (~13) ──────────────────────────────────────────────────────

function detectRubyLibs(dir: string, libs: Set<string>): void {
  if (gemHas(dir, 'cancancan')) libs.add('cancancan');
  if (gemHas(dir, 'capybara')) libs.add('capybara');
  if (gemHas(dir, 'devise')) libs.add('devise');
  if (gemHas(dir, 'factory_bot')) libs.add('factory-bot');
  if (gemHas(dir, 'hotwire-rails')) libs.add('hotwire');
  if (gemHas(dir, 'pundit')) libs.add('pundit');
  if (gemHas(dir, 'rspec') || gemHas(dir, 'rspec-rails')) libs.add('rspec');
  if (gemHas(dir, 'rubocop')) libs.add('rubocop');
  if (gemHas(dir, 'sidekiq')) libs.add('sidekiq');
  if (gemHas(dir, 'stimulus-rails')) libs.add('stimulus');
  if (gemHas(dir, 'stripe')) libs.add('stripe');
  if (gemHas(dir, 'turbo-rails')) libs.add('turbo');
}

// ─── Go (~11) ────────────────────────────────────────────────────────

function detectGoLibs(dir: string, libs: Set<string>): void {
  if (goModHas(dir, 'github.com/gin-gonic/gin')) libs.add('gin');
  if (goModHas(dir, 'github.com/gofiber/fiber')) libs.add('fiber');
  if (goModHas(dir, 'github.com/jackc/pgx')) libs.add('pgx');
  if (goModHas(dir, 'github.com/jmoiron/sqlx')) libs.add('sqlx');
  if (goModHas(dir, 'github.com/labstack/echo')) libs.add('echo');
  if (goModHas(dir, 'github.com/spf13/cobra')) libs.add('cobra');
  if (goModHas(dir, 'github.com/spf13/viper')) libs.add('viper');
  if (goModHas(dir, 'github.com/stretchr/testify')) libs.add('testify');
  if (goModHas(dir, 'go.uber.org/zap')) libs.add('zap');
  if (goModHas(dir, 'google.golang.org/grpc')) libs.add('grpc-go');
  if (goModHas(dir, 'gorm.io/gorm')) libs.add('gorm');
}

// ─── Rust (~13) ──────────────────────────────────────────────────────

function detectRustLibs(dir: string, libs: Set<string>): void {
  if (cargoHas(dir, 'actix-web')) libs.add('actix-web');
  if (cargoHas(dir, 'anyhow')) libs.add('anyhow');
  if (cargoHas(dir, 'axum')) libs.add('axum');
  if (cargoHas(dir, 'clap')) libs.add('clap');
  if (cargoHas(dir, 'diesel')) libs.add('diesel');
  if (cargoHas(dir, 'reqwest')) libs.add('reqwest');
  if (cargoHas(dir, 'rocket')) libs.add('rocket');
  if (cargoHas(dir, 'sea-orm')) libs.add('sea-orm');
  if (cargoHas(dir, 'serde')) libs.add('serde');
  if (cargoHas(dir, 'sqlx')) libs.add('sqlx');
  if (cargoHas(dir, 'thiserror')) libs.add('thiserror');
  if (cargoHas(dir, 'tokio')) libs.add('tokio');
  if (cargoHas(dir, 'tracing')) libs.add('tracing');
}

// ─── Dart (~16) ──────────────────────────────────────────────────────

function detectDartLibs(dir: string, libs: Set<string>): void {
  if (pubHas(dir, 'bloc')) libs.add('bloc');
  if (pubHas(dir, 'cloud_firestore')) libs.add('firestore');
  if (pubHas(dir, 'dio')) libs.add('dio');
  if (pubHas(dir, 'drift')) libs.add('drift');
  if (pubHas(dir, 'firebase_auth')) libs.add('firebase-auth');
  if (pubHas(dir, 'flutter_bloc')) libs.add('flutter-bloc');
  if (pubHas(dir, 'flutter_riverpod')) libs.add('riverpod');
  if (pubHas(dir, 'freezed')) libs.add('freezed');
  if (pubHas(dir, 'get_it')) libs.add('get-it');
  if (pubHas(dir, 'go_router')) libs.add('go-router');
  if (pubHas(dir, 'hive')) libs.add('hive');
  if (pubHas(dir, 'json_serializable')) libs.add('json-serializable');
  if (pubHas(dir, 'provider')) libs.add('provider');
  if (pubHas(dir, 'retrofit')) libs.add('retrofit');
  if (pubHas(dir, 'riverpod')) libs.add('riverpod');
  if (pubHas(dir, 'sqflite')) libs.add('sqflite');
}

// ─── Java / Kotlin (~12) ────────────────────────────────────────────

function detectJavaLibs(dir: string, libs: Set<string>): void {
  if (gradleHas(dir, 'androidx.room')) libs.add('room');
  if (gradleHas(dir, 'com.fasterxml.jackson')) libs.add('jackson');
  if (gradleHas(dir, 'com.squareup.okhttp3')) libs.add('okhttp');
  if (gradleHas(dir, 'com.squareup.retrofit2')) libs.add('retrofit');
  if (gradleHas(dir, 'dagger.hilt')) libs.add('hilt');
  if (gradleHas(dir, 'hibernate-core')) libs.add('hibernate');
  if (gradleHas(dir, 'kotlinx-coroutines')) libs.add('coroutines');
  if (gradleHas(dir, 'lombok')) libs.add('lombok');
  if (gradleHas(dir, 'mockito')) libs.add('mockito');
  if (gradleHas(dir, 'org.junit.jupiter')) libs.add('junit5');
  if (gradleHas(dir, 'spring-boot-starter-data-jpa')) libs.add('spring-data-jpa');
  if (gradleHas(dir, 'spring-boot-starter')) libs.add('spring-boot');
}

// ─── C# (~8) ─────────────────────────────────────────────────────────

function detectCsharpLibs(dir: string, libs: Set<string>): void {
  if (nugetHas(dir, 'AutoMapper')) libs.add('automapper');
  if (nugetHas(dir, 'FluentValidation')) libs.add('fluent-validation');
  if (nugetHas(dir, 'IdentityServer')) libs.add('identity-server');
  if (nugetHas(dir, 'MediatR')) libs.add('mediatr');
  if (nugetHas(dir, 'Microsoft.AspNetCore.SignalR')) libs.add('signalr');
  if (nugetHas(dir, 'Microsoft.EntityFrameworkCore')) libs.add('entity-framework');
  if (nugetHas(dir, 'Serilog')) libs.add('serilog');
  if (nugetHas(dir, 'xunit')) libs.add('xunit');
}
