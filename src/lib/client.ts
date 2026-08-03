import type {
  ActivationState,
  AttentionItem,
  CachedPullRequest,
  DeviceAuthorization,
  DeviceAuthorizationPoll,
  FoundationStatus,
  GithubSyncResult,
} from '../contracts';
import {
  getActivationState,
  getFoundationStatus,
  listAttentionItems,
  listPullRequests,
  openExternalUrl,
  pollGithubAuthorization,
  refreshInbox,
  startGithubAuthorization,
} from './missionControl';
import { createPreviewClient } from './previewClient';

export interface MissionControlClient {
  getFoundationStatus(): Promise<FoundationStatus>;
  getActivationState(): Promise<ActivationState>;
  listAttentionItems(): Promise<AttentionItem[]>;
  listPullRequests(): Promise<CachedPullRequest[]>;
  refreshInbox(): Promise<GithubSyncResult>;
  startGithubAuthorization(): Promise<DeviceAuthorization>;
  pollGithubAuthorization(sessionId: string): Promise<DeviceAuthorizationPoll>;
  openExternalUrl(url: string): Promise<void>;
}

const nativeClient: MissionControlClient = {
  getFoundationStatus,
  getActivationState,
  listAttentionItems,
  listPullRequests,
  refreshInbox,
  startGithubAuthorization,
  pollGithubAuthorization,
  openExternalUrl,
};

export function createMissionControlClient(): MissionControlClient {
  const hasTauriRuntime = '__TAURI_INTERNALS__' in window;
  if (import.meta.env.DEV && !hasTauriRuntime) {
    return createPreviewClient(new URLSearchParams(window.location.search).get('preview'));
  }
  return nativeClient;
}
