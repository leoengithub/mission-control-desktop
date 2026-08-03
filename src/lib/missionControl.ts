import { invoke } from '@tauri-apps/api/core';
import type {
  ActivationState,
  AppSettings,
  AttentionItem,
  CachedPullRequest,
  DeviceAuthorization,
  DeviceAuthorizationPoll,
  FoundationStatus,
  GithubSyncResult,
  SettingsPatch,
} from '../contracts';

export function getFoundationStatus(): Promise<FoundationStatus> {
  return invoke<FoundationStatus>('get_foundation_status');
}

export function getActivationState(): Promise<ActivationState> {
  return invoke<ActivationState>('get_activation_state');
}

export function getSettings(): Promise<AppSettings> {
  return invoke<AppSettings>('get_settings');
}

export function updateSettings(patch: SettingsPatch): Promise<AppSettings> {
  return invoke<AppSettings>('update_settings', { patch });
}

export function listAttentionItems(): Promise<AttentionItem[]> {
  return invoke<AttentionItem[]>('list_attention_items');
}

export function listPullRequests(): Promise<CachedPullRequest[]> {
  return invoke<CachedPullRequest[]>('list_pull_requests');
}

export function refreshInbox(): Promise<GithubSyncResult> {
  return invoke<GithubSyncResult>('refresh_inbox');
}

export function startGithubAuthorization(): Promise<DeviceAuthorization> {
  return invoke<DeviceAuthorization>('start_github_authorization');
}

export function pollGithubAuthorization(sessionId: string): Promise<DeviceAuthorizationPoll> {
  return invoke<DeviceAuthorizationPoll>('poll_github_authorization', { sessionId });
}

export function openExternalUrl(url: string): Promise<void> {
  return invoke<void>('plugin:opener|open_url', { url });
}
