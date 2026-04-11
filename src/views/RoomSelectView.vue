<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useLobbyRooms } from '../composables/useLobbyRooms.js';
import {
  getAuthSession,
  getProfileNickname,
  saveProfileNickname,
} from '../services/SupabaseService.js';
import {
  resolvePolicyBySlug,
  toRoomRouteLocation,
} from '../composables/useRoomPolicy.js';

// RoomSelect の nickname 制約。join 前に同一条件で保存可否を判定する。
const NICKNAME_MIN_LENGTH = 1;
const NICKNAME_MAX_LENGTH = 20;

const normalizeNickname = (nickname) => {
  if (typeof nickname !== 'string') {
    return '';
  }

  return nickname.trim();
};

// 部屋一覧 UI で必要な state。fixed rooms の表示と再取得操作に利用する。
const {
  lobbyRooms,
  roomsLoading,
  roomsErrorMessage,
  fetchLobbyRooms,
} = useLobbyRooms();

// room ルートで BAN により戻された時の通知表示に使う query 参照。
const route = useRoute();

// nickname の保存先 `profiles` を特定するための auth user id。
const currentUserId = ref('');
// 入力フォームで編集中の nickname 値。保存時に trim と長さ検証を行う。
const nicknameInput = ref('');
// `profiles.nickname` から取得した保存済み値。入室可否判定の正本として使う。
const savedNickname = ref('');
// profile 取得中の UI 制御フラグ。
const nicknameLoading = ref(false);
// nickname 保存中の UI 制御フラグ。
const nicknameSaving = ref(false);
// nickname 取得・保存エラーの表示メッセージ。
const nicknameErrorMessage = ref('');
// nickname 保存成功時の表示メッセージ。
const nicknameSuccessMessage = ref('');

const normalizedNicknameInput = computed(() => {
  return normalizeNickname(nicknameInput.value);
});

const hasSavedNickname = computed(() => {
  return savedNickname.value.length >= NICKNAME_MIN_LENGTH;
});

const canSaveNickname = computed(() => {
  if (!currentUserId.value || nicknameLoading.value || nicknameSaving.value) {
    return false;
  }

  const nicknameLength = normalizedNicknameInput.value.length;
  return nicknameLength >= NICKNAME_MIN_LENGTH && nicknameLength <= NICKNAME_MAX_LENGTH;
});

const canEnterRoomSelection = computed(() => {
  return hasSavedNickname.value && !nicknameLoading.value && !nicknameSaving.value;
});

const loadProfileNickname = async () => {
  nicknameLoading.value = true;
  nicknameErrorMessage.value = '';

  try {
    const session = await getAuthSession();
    currentUserId.value = session?.user?.id ?? '';
    if (!currentUserId.value) {
      savedNickname.value = '';
      nicknameInput.value = '';
      nicknameErrorMessage.value = 'ログイン状態を確認できませんでした。再ログインしてください。';
      return;
    }

    const profileNickname = await getProfileNickname(currentUserId.value);
    savedNickname.value = profileNickname;
    nicknameInput.value = profileNickname;
  } catch (error) {
    savedNickname.value = '';
    nicknameInput.value = '';
    nicknameErrorMessage.value = error?.message || String(error);
  } finally {
    nicknameLoading.value = false;
  }
};

const saveNickname = async () => {
  if (!currentUserId.value) {
    nicknameErrorMessage.value = 'ログイン状態を確認できませんでした。再ログインしてください。';
    return;
  }

  const nextNickname = normalizedNicknameInput.value;
  if (nextNickname.length < NICKNAME_MIN_LENGTH || nextNickname.length > NICKNAME_MAX_LENGTH) {
    nicknameErrorMessage.value = 'ニックネームは1文字以上20文字以下で入力してください。';
    return;
  }

  nicknameSaving.value = true;
  nicknameErrorMessage.value = '';
  nicknameSuccessMessage.value = '';

  try {
    const savedProfileNickname = await saveProfileNickname(currentUserId.value, nextNickname);
    savedNickname.value = savedProfileNickname;
    nicknameInput.value = savedProfileNickname;
    nicknameSuccessMessage.value = 'ニックネームを保存しました。';
  } catch (error) {
    nicknameErrorMessage.value = error?.message || String(error);
  } finally {
    nicknameSaving.value = false;
  }
};

const handleRoomCardClick = (event, room) => {
  if (!room?.requiresNicknameBeforeEnter || canEnterRoomSelection.value) {
    return;
  }

  event.preventDefault();
  nicknameSuccessMessage.value = '';
  nicknameErrorMessage.value = '入室前にニックネームを保存してください。';
};

const selectableRooms = computed(() => {
  return lobbyRooms.value
    .map((room) => {
      const roomRouteLocation = toRoomRouteLocation(room);
      if (!roomRouteLocation) {
        return null;
      }

      const roomPolicy = resolvePolicyBySlug(room.slug);
      return {
        ...room,
        roomRouteLocation,
        displayNameJa: roomPolicy?.displayNameJa ?? room.display_name,
        descriptionJa: roomPolicy?.descriptionJa ?? 'ルームを選択して入室します。',
        enterButtonLabelJa: roomPolicy?.enterButtonLabelJa ?? '入室する',
        requiresNicknameBeforeEnter: roomPolicy?.requiresNicknameBeforeEnter ?? true,
      };
    })
    .filter((room) => !!room);
});

const bannedRoomSlug = computed(() => {
  return typeof route.query.ban === 'string' ? route.query.ban : '';
});

const bannedReason = computed(() => {
  return typeof route.query.reason === 'string' ? route.query.reason : '';
});

const bannedMessage = computed(() => {
  if (!bannedRoomSlug.value) {
    return '';
  }

  if (bannedReason.value) {
    return `入室できません: ${bannedReason.value}`;
  }

  return '入室できません。管理者に確認してください。';
});

onMounted(async () => {
  await loadProfileNickname();
});

</script>

<template>
  <main class="min-h-screen bg-gray-50 px-4 py-10">
    <div class="mx-auto w-full max-w-3xl space-y-6">
      <header class="space-y-2">
        <h1 class="text-2xl font-semibold text-gray-900">部屋選択</h1>
        <p class="text-sm text-gray-600">参加する部屋を選択してください。</p>
      </header>

      <div v-if="bannedMessage" class="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {{ bannedMessage }}
      </div>

      <div class="rounded border bg-white p-5 shadow-sm space-y-4">
        <section class="rounded border border-gray-200 bg-gray-50 p-4 space-y-3">
          <div class="space-y-1">
            <h2 class="text-sm font-semibold text-gray-900">表示名（ニックネーム）</h2>
            <p class="text-xs text-gray-600">入室前にニックネームを設定してください。1〜20文字で保存できます。</p>
          </div>

          <div v-if="nicknameLoading" class="text-sm text-gray-600">ニックネームを読み込み中です…</div>

          <div v-else class="space-y-3">
            <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                v-model="nicknameInput"
                maxlength="20"
                type="text"
                class="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                placeholder="ニックネームを入力"
              >
              <button
                class="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                :disabled="!canSaveNickname"
                @click="saveNickname"
              >
                {{ nicknameSaving ? '保存中…' : '保存' }}
              </button>
            </div>

            <p class="text-xs text-gray-500">
              現在の保存済みニックネーム: {{ hasSavedNickname ? savedNickname : '未設定' }}
            </p>
          </div>

          <p v-if="nicknameErrorMessage" class="text-sm text-red-600">{{ nicknameErrorMessage }}</p>
          <p v-else-if="nicknameSuccessMessage" class="text-sm text-green-600">{{ nicknameSuccessMessage }}</p>

          <p v-if="!hasSavedNickname" class="text-sm text-amber-700">
            ニックネーム保存が完了するまで部屋を選択できません。
          </p>
        </section>

        <div v-if="roomsLoading" class="text-sm text-gray-600">部屋一覧を読み込み中です…</div>

        <div v-else-if="roomsErrorMessage" class="space-y-3">
          <p class="text-sm text-red-600">{{ roomsErrorMessage }}</p>
          <button
            class="rounded bg-gray-200 px-3 py-1.5 text-sm text-gray-800 hover:bg-gray-300"
            @click="fetchLobbyRooms"
          >
            再読み込み
          </button>
        </div>

        <div v-else class="grid gap-3 sm:grid-cols-2">
          <RouterLink
            v-for="room in selectableRooms"
            :key="room.slug"
            :to="room.roomRouteLocation"
            :aria-disabled="room.requiresNicknameBeforeEnter && !canEnterRoomSelection"
            :class="[
              'block rounded-lg border border-gray-200 px-4 py-4',
              room.requiresNicknameBeforeEnter && !canEnterRoomSelection
                ? 'cursor-not-allowed bg-gray-100 opacity-70'
                : 'hover:border-blue-400 hover:bg-blue-50',
            ]"
            @click="handleRoomCardClick($event, room)"
          >
            <p class="text-base font-medium text-gray-900">{{ room.displayNameJa }}</p>
            <p class="mt-1 text-xs text-gray-600">{{ room.descriptionJa }}</p>
            <p class="mt-3 inline-flex rounded bg-blue-600 px-2.5 py-1 text-xs font-medium text-white">
              {{ room.enterButtonLabelJa }}
            </p>
            <p class="mt-2 text-xs text-gray-500">識別子: {{ room.slug }}</p>
          </RouterLink>
        </div>
      </div>
    </div>
  </main>
</template>
