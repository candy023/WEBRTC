<script setup>
import { ref, onMounted, onUnmounted } from 'vue'; 
import { SkyWayContext, SkyWayRoom, SkyWayStreamFactory, uuidV4 } from '@skyway-sdk/room';
import { BlurBackground } from 'skyway-video-processors'; // 追加: 背景ぼかし用
import GetToken from './SkywayToken.js';
import { toast } from 'vue3-toastify';
import "vue3-toastify/dist/index.css";
// RNNoise の WebAssembly 版を読み込むためのライブラリ。
// これを使うことで、ブラウザ上で RNNoise のノイズ除去アルゴリズムが動作する。
import { Rnnoise } from "@shiguredo/rnnoise-wasm";

// 環境変数 (vite)
const appId = import.meta.env.VITE_SKYWAY_APP_ID;
const secret = import.meta.env.VITE_SKYWAY_SECRET_KEY;
const tokenString = GetToken(appId, secret);// トークン生成 (GetToken の実装が同期か非同期かで await 必要か確認)
const context = { ctx: null, room: null };// SkyWay context & room
// refs / state
const streamArea = ref(null); 
const roomCreated = ref(false);
const roomId = ref(null);
const joining = ref(false);
const joined = ref(false);
const localMember = ref(null);
const errorMessage = ref(''); 
const remoteVideos = ref([]); 
// 退出時に解放するために保持（追加）
const localVideoStream = ref(null); 
const localAudioStream = ref(null); 
const localVideoEl = ref(null); 
const leaving = ref(false); 
// ミュート状態管理（新規追加）
const isAudioMuted = ref(false); 
const isVideoMuted = ref(false); 
// 画面共有状態管理（追加）
const isScreenSharing = ref(false); 
const isBackgroundBlurred = ref(false);
// UI 折りたたみ/メニュー
const showShareOpen = ref(false); // URL共有の折りたたみ
const showSettingsOpen = ref(false); // 右上の設定メニュー
// Vue の reactivity に巻き込まないため通常変数で保持（Proxy 化による WASM 例外回避）
let backgroundProcessor = null;
const baseUrl = window.location.href.split('?')[0];
// Publication を保持（publish の戻り値として得られるオブジェクト）
const localVideoPublication = ref(null); 
const localAudioPublication = ref(null);
const enlargedVideo = ref(null);
// 追加: 重複 subscribe 防止用（publication.id を記録）
const subscribedPublicationIds = new Set();
// 追加: ルームイベントのハンドラ参照（退出時に解除するため）
const roomEventHandlers = { onStreamPublished: null };
// devicechange ハンドラ参照（追加）
let deviceChangeHandler = null;


// 目的: 現在「話している」参加者を映像枠のスタイルで強調表示する。
// 手法概要:
//   (A) RMSベース: AnalyserNode の時間領域データから移動平均RMSを算出し二重閾値で安定判定。
//   (B) RNNoise VADベース: ローカル音声に限り RNNoise の VAD 値(0..1)を受信。
//       → RMS が低くても VAD が十分高い場合は “話している” とみなす補強判定。
//   (C) 判定結果が変化した時のみ DOM 更新し描画負荷を最小化。

const audioContext = ref(null);            // 単一共有 AudioContext (必要時に遅延生成)
let audioLevelAnimationId = null;          // rAF ループ用 ID （null なら未稼働）
const speakerAnalyzers = new Map();        // memberId -> { analyser, data:Uint8Array, history:number[], speaking:boolean }
const speakingThresholdOn = 0.04;          // 発話開始 (RMS) 閾値
const speakingThresholdOff = 0.02;         // 発話終了 (RMS) 閾値
const rmsHistoryLength = 5;                // 移動平均に用いる履歴サンプル数
const vadSpeakingThreshold = 0.6;          // VAD補強判定 閾値 (0..1)
const latestVadValue = ref(0);             // RNNoise Worklet からの最新 VAD 値
const isRnnoiseEnabled = ref(true);        // RNNoise ON/OFF トグル状態

// AudioContext を必要になったタイミングで生成（Safari 等でも互換性確保）
const ensureAudioContext = () => {
  if (!audioContext.value) {
    try {
      audioContext.value = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      console.warn('AudioContext 作成失敗:', e);
    }
  }
  return audioContext.value;
};

// 指定 memberId の映像コンテナ要素取得 (ハイライト対象)
const getContainerForMember = (memberId) => {
  if (!streamArea.value) return null;
  return streamArea.value.querySelector(`[data-member-id="${memberId}"]`);
};

// 発話状態に応じ枠スタイルを更新（変化時のみ副作用）
const updateSpeakingVisual = (memberId, speaking) => {
  const container = getContainerForMember(memberId);
  if (!container) return;
  if (speaking) {
    container.classList.add('speaking');
    container.style.outline = '3px solid #22c55e';
    container.style.boxShadow = '0 0 8px #22c55e';
  } else {
    container.classList.remove('speaking');
    container.style.outline = '';
    container.style.boxShadow = '';
  }
};

// 指定メンバーの音声トラックを解析対象として登録 (重複はスキップ)
const setupAudioLevel = (memberId, track) => {
  if (!track || track.kind !== 'audio') return;            // 無効トラック拒否
  if (speakerAnalyzers.has(memberId)) return;              // 既存登録回避
  const ctx = ensureAudioContext();
  if (!ctx) return;
  try {
    const ms = new MediaStream([track]);                   // 単一トラックのみを MediaStream 化
    const src = ctx.createMediaStreamSource(ms);           // Web Audio 入口ノード
    const analyser = ctx.createAnalyser();                 // 軽量時間領域解析ノード
    analyser.fftSize = 512;                                // 分解能（負荷とバランス）
    src.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);         // 波形格納用バッファ
    speakerAnalyzers.set(memberId, { analyser, data, history: [], speaking: false });
  } catch (e) {
    console.warn('setupAudioLevel 失敗:', e);
  }
};

// ByteTimeDomainData (0..255) を -1..1 に正規化し RMS を算出
const computeRms = (data) => {
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const v = (data[i] - 128) / 128; // 中心 128 → 0
    sum += v * v;
  }
  return Math.sqrt(sum / data.length); // RMS (0..1 目安)
};

// rAF で全参加者の最新 RMS を計算し発話状態を更新
const audioLevelLoop = () => {
  for (const [memberId, obj] of speakerAnalyzers.entries()) {
    obj.analyser.getByteTimeDomainData(obj.data);          // 波形取得
    const rms = computeRms(obj.data);                      // 単発 RMS
    obj.history.push(rms);                                 // 履歴蓄積
    if (obj.history.length > rmsHistoryLength) obj.history.shift();
    const avg = obj.history.reduce((a, b) => a + b, 0) / obj.history.length; // 移動平均RMS
    const prev = obj.speaking;
    let next = prev;
    // ① RMS 二重閾値判定
    if (!prev && avg >= speakingThresholdOn) next = true;
    else if (prev && avg < speakingThresholdOff) next = false;
    // ② VAD 補強判定（ローカルメンバーのみ対象）
    if (localMember.value && memberId === localMember.value.id) {
      if (!next && latestVadValue.value >= vadSpeakingThreshold) {
        next = true; // RMS低いが VAD 高い → 発話中と補正
      }
    }
    if (next !== prev) {
      obj.speaking = next;
      updateSpeakingVisual(memberId, next);                // 変化時のみ DOM 更新
    }
  }
  audioLevelAnimationId = requestAnimationFrame(audioLevelLoop); // 次フレーム継続
};

// 解析ループ開始（まだ動いていない場合のみ）
const startAudioLevelMonitor = () => {
  if (audioLevelAnimationId == null) {
    try { audioContext.value?.resume?.(); } catch {}
    audioLevelAnimationId = requestAnimationFrame(audioLevelLoop);
  }
};

// 解析停止とリソース破棄（退出時など）
const stopAudioLevelMonitor = () => {
  if (audioLevelAnimationId != null) {
    cancelAnimationFrame(audioLevelAnimationId);
    audioLevelAnimationId = null;
  }
  for (const memberId of speakerAnalyzers.keys()) updateSpeakingVisual(memberId, false); // ハイライト解除
  speakerAnalyzers.clear();
  try { audioContext.value?.close?.(); } catch {}
  audioContext.value = null;
};

// 追加： デバイス選択用の state
const videoInputDevices = ref([]);
const audioInputDevices = ref([]);
const audioOutputDevices = ref([]);
const selectedVideoInputId = ref('');
const selectedAudioInputId = ref('');
const selectedAudioOutputId = ref('');

// UI: パネル表示フラグと一時選択（ボタン押下で開いて確定/キャンセルする）
const showCameraPanel = ref(false);
const showMicPanel = ref(false);
const showSpeakerPanel = ref(false);
const tempSelectedVideoInputId = ref('');
const tempSelectedAudioInputId = ref('');
const tempSelectedAudioOutputId = ref('');

const openCameraPanel = () => {
  tempSelectedVideoInputId.value = selectedVideoInputId.value || (videoInputDevices.value[0]?.deviceId || '');
  showCameraPanel.value = true;
};
const cancelCameraPanel = () => { showCameraPanel.value = false; };
const confirmCameraPanel = async () => {
  selectedVideoInputId.value = tempSelectedVideoInputId.value;
  showCameraPanel.value = false;
  await changeVideoInput();
};

const openMicPanel = () => {
  tempSelectedAudioInputId.value = selectedAudioInputId.value || (audioInputDevices.value[0]?.deviceId || '');
  showMicPanel.value = true;
};
const cancelMicPanel = () => { showMicPanel.value = false; };
const confirmMicPanel = async () => {
  selectedAudioInputId.value = tempSelectedAudioInputId.value;
  showMicPanel.value = false;
  await changeAudioInput();
};

const openSpeakerPanel = () => {
  tempSelectedAudioOutputId.value = selectedAudioOutputId.value || (audioOutputDevices.value[0]?.deviceId || '');
  showSpeakerPanel.value = true;
};
const cancelSpeakerPanel = () => { showSpeakerPanel.value = false; };
const confirmSpeakerPanel = () => {
  selectedAudioOutputId.value = tempSelectedAudioOutputId.value;
  showSpeakerPanel.value = false;
  changeAudioOutput();
};

// 背景ぼかし ON
const enableBackgroundBlur = async () => {
  if (!joined.value || !localMember.value) return;
  if (isScreenSharing.value) {
    toast.info('画面共有中は背景ぼかしを使用できません');
    return;
  }
  try {
    // 既存の映像を unpublish
    if (localVideoPublication.value) {
      await localMember.value.unpublish(localVideoPublication.value);
    }
    // 既存の映像トラックを解放
    if (localVideoStream.value) {
      localVideoStream.value.release?.();
    }
    // プロセッサ初期化
    backgroundProcessor = new BlurBackground();
    await backgroundProcessor.initialize();
    // 加工映像の VideoStream を作成
    const processedVideo = await SkyWayStreamFactory.createCustomVideoStream(backgroundProcessor, {
      stopTrackWhenDisabled: true,
    });
    localVideoStream.value = processedVideo;
    // publish
    const videoPub = await localMember.value.publish(processedVideo);
    localVideoPublication.value = videoPub;
    // ローカル映像を置き換え
    if (localVideoEl.value) {
      processedVideo.attach(localVideoEl.value);
    }
    isBackgroundBlurred.value = true;
    toast.success('背景ぼかしを有効化しました');
  } catch (e) {
    console.error('背景ぼかし有効化エラー:', e);
    toast.error('背景ぼかしの有効化に失敗しました: ' + (e?.message || e));
  }
};

// 背景ぼかし OFF（通常カメラに戻す）
const disableBackgroundBlur = async () => {
  if (!joined.value || !localMember.value) return;
  try {
    if (localVideoPublication.value) {
      await localMember.value.unpublish(localVideoPublication.value);
    }
    if (localVideoStream.value) {
      localVideoStream.value.release?.();
    }
    // プロセッサ破棄（存在すれば）
    try { await backgroundProcessor?.dispose?.(); } catch {}
    backgroundProcessor = null;
    // 通常カメラに復帰（選択デバイスがあれば反映）
    const cameraStream = await SkyWayStreamFactory.createCameraVideoStream(
      selectedVideoInputId.value ? { video: { deviceId: selectedVideoInputId.value } } : undefined
    );
    localVideoStream.value = cameraStream;
    const videoPub = await localMember.value.publish(cameraStream);
    localVideoPublication.value = videoPub;
    if (localVideoEl.value) {
      cameraStream.attach(localVideoEl.value);
    }
    isBackgroundBlurred.value = false;
    toast.success('背景ぼかしを無効化しました');
  } catch (e) {
    console.error('背景ぼかし無効化エラー:', e);
    toast.error('背景ぼかしの無効化に失敗しました: ' + (e?.message || e));
  }
};

const toggleBackgroundBlur = async () => {
  if (isBackgroundBlurred.value) return disableBackgroundBlur();
  return enableBackgroundBlur();
};


const Noise_Suppression = async (deviceId) => {
  // ① ブラウザ標準オプション（RNNoise失敗時フォールバック用）
  //    SkyWay の createMicrophoneAudioStream にも渡す形を揃える
  const audioConstraints = {
    noiseSuppression: true,
    echoCancellation: true,
    autoGainControl: true,
    ...(deviceId ? { deviceId } : {})
  };
  // SkyWay へ渡す & getUserMedia 用の共通 constraints
  const constraints = { audio: audioConstraints };

  try {
  
    // ② AudioContext 作成（Worklet, Graph の土台）
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();

    
    // ③ RNNoise Worklet モジュール登録（public/ 配下はルート配信）
    await audioContext.audioWorklet.addModule('/rnnoise-processor.js');

    // ④ RNNoise WASM ロード & DenoiseState 生成（frameSize 把握）
    const rn = await Rnnoise.load();
    const denoiseState = rn.createDenoiseState(); // processFrame(frame) で in-place ノイズ抑制

    // ⑤ 生マイク MediaStream 取得（指定 deviceId 反映済み）
    const rawStream = await navigator.mediaDevices.getUserMedia(constraints);

    // ⑥ MediaStream → AudioNode 化（Worklet 接続準備）
    const inputSourceNode = audioContext.createMediaStreamSource(rawStream);

    // ⑦ RNNoise AudioWorkletNode 生成（frameSize/VAD間隔を processorOptions で渡す）
    const rnnoiseNode = new AudioWorkletNode(audioContext, 'rnnoise-processor', {
      processorOptions: {
        // 修正: denoiseState は構造化クローン不可(DataCloneError)のため渡さない
        // 参考: AudioWorkletNode の processorOptions は Structured Clone 必須
        frameSize: rn.frameSize,
        vadInterval: 10
      }
    });
    // 任意: VAD 値受信（話者検出等へ利用したい場合）
    rnnoiseNode.port.onmessage = (ev) => {
      if (ev.data?.type === 'vad') {
        latestVadValue.value = ev.data.value; // 最新VAD値更新（RMS低いケース補強）
      }
    };


    // ⑧ 出力 MediaStream ノード（SkyWay publish 用 Track 抽出先）
    const outputDestinationNode = audioContext.createMediaStreamDestination();
  
    // ⑨ AudioGraph 構築: マイク → RNNoise → 出力
    inputSourceNode.connect(rnnoiseNode).connect(outputDestinationNode);
   
    // ⑩ ノイズ抑制後 Track 取得（null フォールバック考慮）
    const denoisedTrack = outputDestinationNode.stream.getAudioTracks()[0] || null;

    // ⑪ 後始末用 cleanup（切替/退出時に呼び出し）
    //     DenoiseState の destroy を忘れると WASM メモリリーク
    const cleanup = () => {
      try { inputSourceNode.disconnect(); } catch {}
      try { rnnoiseNode.disconnect(); } catch {}
      try { denoiseState.destroy(); } catch {}
      try { audioContext.close(); } catch {}
      try { rawStream.getTracks().forEach(t => t.stop()); } catch {}
    };

    return { constraints, denoisedTrack, cleanup };
  } catch (e) {
    console.warn('RNNoise 初期化/接続失敗。フォールバックします:', e);
    // 失敗時は標準処理（ブラウザネイティブDSP）に任せる
    return { constraints, denoisedTrack: null, cleanup: () => {} };
  }
};

// 🆕 SkyWay API でデバイス一覧を取得
const loadDevices = async () => {
  try {
    // デバイス名を取得するため、まず一度ストリームを取得
    const tempStream = await SkyWayStreamFactory.createMicrophoneAudioAndCameraStream();
    // すぐに停止
    tempStream.audio?.release();
    tempStream.video?.release();
    
    // SkyWay API でデバイス一覧を取得
    videoInputDevices.value = await SkyWayStreamFactory.enumerateInputVideoDevices();
    audioInputDevices.value = await SkyWayStreamFactory.enumerateInputAudioDevices();
    audioOutputDevices.value = await SkyWayStreamFactory.enumerateOutputAudioDevices();
    
    // デフォルトデバイスを選択
    if (videoInputDevices.value.length > 0 && !selectedVideoInputId.value) {
      selectedVideoInputId.value = videoInputDevices.value[0].deviceId;
    }
    if (audioInputDevices.value.length > 0 && !selectedAudioInputId.value) {
      selectedAudioInputId.value = audioInputDevices.value[0].deviceId;
    }
    if (audioOutputDevices.value.length > 0 && !selectedAudioOutputId.value) {
      selectedAudioOutputId.value = audioOutputDevices.value[0].deviceId;
    }
  } catch (e) {
    console.error('デバイス取得失敗:', e);
    toast.error('デバイス一覧の取得に失敗しました');
  }
  // loadDevices の try ブロックの最後に追加（デバッグ用）
console.log('videoInputDevices:', videoInputDevices.value);
console.log('audioInputDevices:', audioInputDevices.value);
console.log('audioOutputDevices:', audioOutputDevices.value);
};

// ヘルパ: SkyWay stream オブジェクトから MediaStreamTrack を取り出す
const extractTrack = (stream, kind = 'video') => {
  if (!stream) return null;
  // SDK が .track を提供している場合
  if (stream.track && stream.track.kind === kind) return stream.track;
  // SDK が .mediaStream を持つ場合
  if (stream.mediaStream) {
    const tracks = kind === 'audio'
      ? stream.mediaStream.getAudioTracks()
      : stream.mediaStream.getVideoTracks();
    if (tracks && tracks.length) return tracks[0];
  }
  // もし渡されるのが生の MediaStream の場合
  if (typeof stream.getTracks === 'function') {
    const tracks = kind === 'audio' ? stream.getAudioTracks() : stream.getVideoTracks();
    if (tracks && tracks.length) return tracks[0];
  }
  return null;
};

// SkyWay Context 作成
const getContext = async () => {
  try {
    context.ctx = await SkyWayContext.Create(tokenString);
    // トークン更新リマインダ (必要ならここで新規トークンを fetch して差し替える)
    context.ctx.onTokenUpdateReminder.add(async () => {
      // const newToken = await fetchNewToken();
      context.ctx.updateAuthToken(tokenString);
    });
    return context.ctx;
  } catch (e) {
    toast.error('認証失敗: ' + e);
    console.error(e);
  }
};

// ルーム作成
const createRoom = async () => {
  try {
    if (!roomId.value) {
      roomId.value = uuidV4();
    }
    context.room = await SkyWayRoom.FindOrCreate(context.ctx, {
      type: 'sfu',
      name: roomId.value
    });
    roomCreated.value = true;
  } catch (e) {
    toast.error('Room 作成失敗: ' + e);
    console.error(e);
  }
};
// 受信ストリームをDOMへattach（映像/音声対応）
// track の onmute/onunmute で動画の見た目（暗転）を制御
// 受信ストリームをDOMへattach（映像/音声対応）
// attachRemoteStream関数でボタンに固有IDを設定
const attachRemoteStream = (stream, publication) => {
  try {
    if (!streamArea.value) return;

    const hasVideo = !!(stream?.track?.kind === 'video' || (stream.mediaStream && stream.mediaStream.getVideoTracks?.().length));
    const hasAudio = !!(stream?.track?.kind === 'audio' || (stream.mediaStream && stream.mediaStream.getAudioTracks?.().length));

    if (hasVideo) {
      const container = document.createElement('div');
      // グリッド項目としてサイズを親に任せ、縦横比を維持
      container.className = 'relative w-full aspect-video bg-black rounded overflow-hidden';

      // メンバーID付与（話者ハイライト用）
      if (publication?.publisher?.id) {
        container.dataset.memberId = publication.publisher.id;
      }

    // 追加: publication id を保持（削除用に使う）映像の枠の削除の他
    if (publication?.id) {
    container.dataset.pubId = publication.id;
     }


      streamArea.value.appendChild(container);

      const el = document.createElement('video');
      el.autoplay = true;
      el.playsInline = true;
      // タイル内で全面表示（親が aspect-video を担保）
      el.className = 'w-full h-full object-cover';
      container.appendChild(el);

      // 拡大ボタンを作成
      const enlargeBtn = document.createElement('button');
      enlargeBtn.innerHTML = '⛶';
      enlargeBtn.className = 'absolute top-2 right-2 bg-black bg-opacity-50 text-white p-1 rounded hover:bg-opacity-70 text-sm';
      
      // より確実なイベント設定
      enlargeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        enlargeVideo(el);
      });
      
      container.appendChild(enlargeBtn);

      // 要素の関連付けを保存
      el.__container = container;
      el.__enlargeBtn = enlargeBtn;

      stream.attach(el);
      el.play?.().catch(() => {});

      const track = extractTrack(stream, 'video');
      if (track) {
        if (track.enabled === false) {
          el.style.filter = 'brightness(30%)';
        }
        track.onmute = () => {
          el.style.filter = 'brightness(30%)';
        };
        track.onunmute = () => {
          el.style.filter = 'none';
        };
      }

      remoteVideos.value.push(container);
      console.log('[REMOTE] created element', {
        pubId: publication?.id,
        publisherId: publication?.publisher?.id,
        totalContainers: streamArea.value?.querySelectorAll('[data-pub-id]').length
      });
    } else if (hasAudio) {
      const el = document.createElement('audio');
      el.autoplay = true;
      el.controls = false;
      el.style.display = 'none';
      streamArea.value.appendChild(el);
      stream.attach(el);
      // 出力先が選択されていれば可能なブラウザで setSinkId を適用
      try {
        if (selectedAudioOutputId.value && typeof el.setSinkId === 'function') {
          el.setSinkId(selectedAudioOutputId.value).catch((err) => {
            console.warn('setSinkId on remote audio failed:', err);
          });
        }
      } catch (e) {
        console.warn('apply setSinkId failed:', e);
      }
      el.play?.().catch(() => {});
      remoteVideos.value.push(el);

      // 音声トラックで話者検出セットアップ
      try {
        if (publication?.publisher?.id) {
          const audioTrack = extractTrack(stream, 'audio');
          setupAudioLevel(publication.publisher.id, audioTrack);
          startAudioLevelMonitor();
        }
      } catch (e) {
        console.warn('remote audio level setup failed:', e);
      }
    }
  } catch (err) {
    console.error('attachRemoteStream failed:', err);
  }
}

// Publication.disable/enable を使ってミュートする関数（優先）
const togglePublicationMute = async (pubRef, isMutedRef) => {
  const pub = pubRef.value;
  if (!pub) return false;
  try {
    const willMute = !isMutedRef.value;
    if (willMute) {
      // mute
      if (typeof pub.disable === 'function') {
        await pub.disable();
        isMutedRef.value = true;
        return true;
      }
    } else {
      // unmute
      if (typeof pub.enable === 'function') {
        await pub.enable();
        isMutedRef.value = false;
        return true;
      }
    }
  } catch (e) {
    console.error('togglePublicationMute error:', e);
    return false;
  }
  return false;
};

// 代替: MediaStreamTrack.enabled を切り替えるフォールバック
const setStreamMutedFallback = (skywayStream, kind, muted) => {
  const track = extractTrack(skywayStream, kind);
  if (!track) {
    console.warn('No track found for fallback mute:', kind, skywayStream);
    return false;
  }
  try {
    track.enabled = !muted;
    return true;
  } catch (e) {
    console.error('setStreamMutedFallback error:', e);
    return false;
  }
};

// 音声ミュート切り替え
const toggleAudioMute = async () => {
  // まず Publication API を試す
  let ok = await togglePublicationMute(localAudioPublication, isAudioMuted);
  if (!ok) {
    // フォールバック: track.enabled を切り替える
    const newMuted = !isAudioMuted.value;
    const fOk = setStreamMutedFallback(localAudioStream.value, 'audio', newMuted);
    if (fOk) isAudioMuted.value = newMuted;
    ok = fOk;
  }
  if (!ok) console.warn('Audio mute/unmute failed (no publication & no track)');
};

// 映像ミュート切り替え（修正版）
const toggleVideoMute = async () => {
  // まず Publication API を試す（togglePublicationMute は isMutedRef を更新する）
  let ok = await togglePublicationMute(localVideoPublication, isVideoMuted);

  // Publication API が使えずフォールバックした場合はここでフラグを反転して更新する
  if (!ok) {
    const newMuted = !isVideoMuted.value;
    const fOk = setStreamMutedFallback(localVideoStream.value, 'video', newMuted);
    if (fOk) {
      isVideoMuted.value = newMuted;
      ok = true;
    }
  }

  // 最終的なフラグ IsVideoMuted.value を参照してローカルの見た目を更新（反転や ! を使わない）
  if (localVideoEl.value) {
    localVideoEl.value.style.filter = isVideoMuted.value ? 'brightness(30%)' : 'none';
  }

  if (!ok) console.warn('Video mute/unmute failed (no publication & no track)');
};
// RNNoise ON/OFF トグル（参加中であれば即時再適用）
const toggleRnnoise = async () => {
  isRnnoiseEnabled.value = !isRnnoiseEnabled.value;
  if (joined.value) {
    await changeAudioInput();
    toast.success(`RNNoiseを${isRnnoiseEnabled.value ? '有効化' : '無効化'}しました`);
  }
};
//画面共有
const screenShare = async () => {
  if (!localMember.value) return;
  
  try {
    if (isScreenSharing.value) {
      // 画面共有停止 - 元のカメラ映像に戻す
      await localMember.value.unpublish(localVideoPublication.value);
      // カメラ映像を再作成してpublish
      const cameraStream = await SkyWayStreamFactory.createCameraVideoStream();
      localVideoStream.value = cameraStream;
      localVideoPublication.value = await localMember.value.publish(cameraStream);
      
      // ローカル映像要素を更新
      if (localVideoEl.value) {
        cameraStream.attach(localVideoEl.value);
      }
      
      isScreenSharing.value = false;
    } else {
      // 画面共有開始
      const { video: screenStream } = await SkyWayStreamFactory.createDisplayStreams({
        audio: false,
        video: {
          displaySurface: 'monitor'
        }
      });
      
      // 現在の映像をunpublish
      await localMember.value.unpublish(localVideoPublication.value);
      
      // 画面共有をpublish
      localVideoStream.value = screenStream;
      localVideoPublication.value = await localMember.value.publish(screenStream);
      
      // ローカル映像要素を更新
      if (localVideoEl.value) {
        screenStream.attach(localVideoEl.value);
      }
      
      isScreenSharing.value = true;
    }
  } catch (error) {
    console.error('画面共有エラー:', error);
    toast.value = '画面共有に失敗しました: ' + error.message;
  }
};

// 🆕 マイク入力デバイスを切り替える（簡潔版）
const changeAudioInput = async () => {
  if (!joined.value || !localMember.value) return;
  
  try {
    if (localAudioPublication.value) {
      await localMember.value.unpublish(localAudioPublication.value);
    }
    
    if (localAudioStream.value) {
      localAudioStream.value.release?.();
    }
    
    // 新しいマイクストリーム生成（RNNoise 使用有無で分岐）
    const ns = isRnnoiseEnabled.value
      ? await Noise_Suppression(selectedAudioInputId.value)
      : { constraints: { audio: { deviceId: selectedAudioInputId.value } }, denoisedTrack: null, cleanup: () => {} };
    let audioStream = await SkyWayStreamFactory.createMicrophoneAudioStream(ns.constraints);
    // 修正: SkyWay の LocalMediaStreamBase は track が getter のため差し替え不可
    //       → 直接差し替えは行わない（VADはWorklet通知を使用）
    localAudioStream.value = audioStream;
    
    const audioPub = await localMember.value.publish(audioStream);
    localAudioPublication.value = audioPub;
    
    toast.success('マイクを切り替えました');
  } catch (e) {
    console.error('マイク切り替えエラー:', e);
    toast.error('マイクの切り替えに失敗しました: ' + e.message);
  }
};

// 🆕 カメラ入力デバイスを切り替える
const changeVideoInput = async () => {
  if (!joined.value || !localMember.value || isScreenSharing.value) return;
  if (isBackgroundBlurred.value) {
    toast.info('背景ぼかし有効中はカメラ切替は未対応です（ぼかしをOFFにしてから切替）');
    return;
  }
  
  try {
    if (localVideoPublication.value) {
      await localMember.value.unpublish(localVideoPublication.value);
    }
    
    if (localVideoStream.value) {
      localVideoStream.value.release?.();
    }
    
    // 🆕 SkyWay API で選択されたデバイスのストリームを作成
    const videoStream = await SkyWayStreamFactory.createCameraVideoStream({
      video: { deviceId: selectedVideoInputId.value }
    });
    localVideoStream.value = videoStream;
    
    const videoPub = await localMember.value.publish(videoStream);
    localVideoPublication.value = videoPub;
    
    if (localVideoEl.value) {
      videoStream.attach(localVideoEl.value);
    }
    
    toast.success('カメラを切り替えました');
  } catch (e) {
    console.error('カメラ切り替えエラー:', e);
    toast.error('カメラの切り替えに失敗しました: ' + e.message);
  }
};

// 🆕 音声出力デバイスを切り替える（簡潔版）
const changeAudioOutput = () => {
  const audioElements = streamArea.value?.querySelectorAll('audio');
  audioElements?.forEach(el => {
    if (el.setSinkId && selectedAudioOutputId.value) {
      el.setSinkId(selectedAudioOutputId.value).catch(e => {
        console.warn('setSinkId failed:', e);
      });
    }
  });
  toast.success('スピーカーを切り替えました');
};


// 映像拡大機能
const enlargeVideo = (videoEl) => {
  if (enlargedVideo.value) return;
  
  videoEl.__originalClass = videoEl.className;
  videoEl.__originalParent = videoEl.parentNode;
  videoEl.__originalNextSibling = videoEl.nextSibling; // 元の位置を保存
  
  videoEl.className = 'fixed inset-0 w-screen h-screen object-contain bg-black z-50 cursor-pointer';
  document.body.appendChild(videoEl);
  
  // 閉じるボタンを追加
  const closeBtn = document.createElement('button');
  closeBtn.innerHTML = '✕';
  closeBtn.className = 'fixed top-4 right-4 z-50 bg-red-600 text-white p-3 rounded-full hover:bg-red-700 text-xl font-bold';
  closeBtn.onclick = (e) => {
    e.stopPropagation();
    shrinkVideo();
  };
  document.body.appendChild(closeBtn);
  
  // 映像をクリックで閉じる
  videoEl.onclick = shrinkVideo;
  
  videoEl.__closeBtn = closeBtn;
  enlargedVideo.value = videoEl;
};

// shrinkVideo関数を以下のように修正
const shrinkVideo = () => {
  if (!enlargedVideo.value) return;
  
  const videoEl = enlargedVideo.value;
  videoEl.className = videoEl.__originalClass;
  
  // 元の位置に正確に戻す
  if (videoEl.__originalNextSibling) {
    videoEl.__originalParent.insertBefore(videoEl, videoEl.__originalNextSibling);
  } else {
    videoEl.__originalParent.appendChild(videoEl);
  }
  
  videoEl.onclick = null; // クリックイベントを削除
  
  // 閉じるボタンを削除
  if (videoEl.__closeBtn) {
    videoEl.__closeBtn.remove();
    delete videoEl.__closeBtn;
  }
  
  // 保存した参照をクリーンアップ
  delete videoEl.__originalNextSibling;
  
  enlargedVideo.value = null;
};

// ESCキーで縮小（追加）
const handleKeydown = (e) => {
  if (e.key === 'Escape' && enlargedVideo.value) {
    shrinkVideo();
  }
};

// ルーム参加
const joinRoom = async () => {
  if (joining.value || joined.value || leaving.value) return; // Leaving 中は不可（追加）
  if (!roomId.value) {
    toast.error('ルームIDが設定されていません');
    return;
  }
  // DEBUG: 開始ログ
  console.log('[JOIN] START', {
    roomId: roomId.value,
    roomCreated: roomCreated.value,
    joined: joined.value,
    joining: joining.value,
    leaving: leaving.value
  });

  try {
    joining.value = true;

    // まだルームが作成されていない場合は作る
    if (!roomCreated.value || !context.room) { // room を破棄するので null チェック追加
      await createRoom();
      console.log('[JOIN] createRoom 完了', {
        roomId: context.room?.id,
        publications: context.room?.publications?.length
      });
    }

    // join
    const member = await context.room.join({ name: uuidV4() });
    localMember.value = member;
    console.log('[JOIN] joined', {
      localMemberId: member.id,
      roomMembers: context.room.members.map(m => m.id)
    });

    // ローカルカメラ映像
    const videoStream = await SkyWayStreamFactory.createCameraVideoStream();
    // 音声: RNNoise 有効ならノイズ抑制 / 無効なら通常マイク
    const nsJoin = isRnnoiseEnabled.value
      ? await Noise_Suppression(selectedAudioInputId.value)
      : { constraints: { audio: { deviceId: selectedAudioInputId.value } }, denoisedTrack: null, cleanup: () => {} };
    let audioStream = await SkyWayStreamFactory.createMicrophoneAudioStream(nsJoin.constraints);
    // 修正: join 時も track 差し替えは行わない（forwarding失敗回避）
    // 退出時に解放するため保持（追加）
    localVideoStream.value = videoStream;
    localAudioStream.value = audioStream;

    // publish と Publication を保持（戻り値を受け取る）
    const videoPub = await member.publish(videoStream);
    const audioPub = await member.publish(audioStream);
    localVideoPublication.value = videoPub;
    localAudioPublication.value = audioPub;
    console.log('[JOIN] publish 完了', {
      videoPubId: videoPub.id,
      audioPubId: audioPub.id
    });

    // デバッグ出力（Join 後に Console で確認しやすくする）
    console.log('LocalVideoPublication:', localVideoPublication.value);
    console.log('LocalAudioPublication:', localAudioPublication.value);
    try {
      window.__localVideoPublication = localVideoPublication.value;
      window.__localAudioPublication = localAudioPublication.value;
    } catch (e) {}

    // ローカル video 要素
    // ローカル映像用コンテナ（追加）
    const localContainer = document.createElement('div');
    // ローカルも同じタイル仕様に統一
    localContainer.className = 'relative w-full aspect-video bg-black rounded overflow-hidden';
    streamArea.value.appendChild(localContainer);

    // DOM 変数名を ref と衝突させないよう localVideoElement と命名
    const localVideoElement = document.createElement('video');
    localVideoElement.muted = true;
    localVideoElement.playsInline = true;
    localVideoElement.autoplay = true;
    localVideoElement.className = 'w-full h-full object-cover';
    localContainer.appendChild(localVideoElement);

    // 自分のメンバーID付与
    try { if (member.id) localContainer.dataset.memberId = member.id; } catch {}

    // ローカル映像用拡大ボタン（追加）
    const localEnlargeBtn = document.createElement('button');
    localEnlargeBtn.innerHTML = '⛶';
    localEnlargeBtn.className = 'absolute top-2 right-2 bg-black bg-opacity-50 text-white p-1 rounded hover:bg-opacity-70 text-sm';
    localEnlargeBtn.onclick = () => enlargeVideo(localVideoElement);
    localContainer.appendChild(localEnlargeBtn);

    // SkyWay の stream を video に接続
    videoStream.attach(localVideoElement);
    // 退出や切替で使えるように ref に DOM を保存
    localVideoEl.value = localVideoElement;
    console.log('[JOIN] ローカル video 要素 attach 完了');

    // 追加: 既に公開済みの publication にも一度だけ subscribe（自分のは除外）
    try {
      const pubs = context.room.publications ?? [];
      console.log('[JOIN] 既存 publication 数:', pubs.length);
      for (const pub of pubs) {
        if (pub.publisher.id === member.id) continue;
        if (subscribedPublicationIds.has(pub.id)) continue;
        const { stream } = await member.subscribe(pub.id);
        subscribedPublicationIds.add(pub.id);
        // attachRemoteStream(stream);
        attachRemoteStream(stream, pub);
        console.log('[JOIN] 既存 pub subscribe', pub.id);
      }
    } catch (err) {
      console.warn('subscribe existing pubs failed:', err);
    }

    // 以後新規公開にもsubscribe（重要）
    // 追加: ハンドラを保持して退出時に解除、重複subscribe防止
    roomEventHandlers.onStreamPublished = async (e) => {
      // DEBUG: 発火ログ（publisher / localMember / pubId を全て表示）
      console.log('[EVENT] onStreamPublished', {
        pubId: e.publication.id,
        publisherId: e.publication.publisher.id,
        localMemberId: member.id,
        isLocalById: e.publication.publisher.id === member.id
      });

      // NOTE: 自分の publication を確実に除外（ID / publisher 両面）
      if (
        e.publication.publisher.id === member.id ||
        (localVideoPublication.value && e.publication.id === localVideoPublication.value.id) ||
        (localAudioPublication.value && e.publication.id === localAudioPublication.value.id)
      ) {
        console.log('[EVENT] 自分の publication のため subscribe スキップ', e.publication.id);
        return;
      }

      if (subscribedPublicationIds.has(e.publication.id)) {
        console.log('[EVENT] duplicate skip', e.publication.id);
        return;
      }
      try {
        const { stream } = await member.subscribe(e.publication.id);
        subscribedPublicationIds.add(e.publication.id);
        console.log('[EVENT] 新規 pub subscribe', e.publication.id);
        // attachRemoteStream(stream);
        attachRemoteStream(stream, e.publication);
      } catch (err) {
        console.warn('subscribe new pub failed:', err);
      }
    };
    context.room.onStreamPublished.add(roomEventHandlers.onStreamPublished);
    console.log('[JOIN] onStreamPublished ハンドラ登録');
    // 最小追加: unpublish イベントで DOM を削除
    context.room.onStreamUnpublished.add((e) => {
    const pubId = e.publication.id;
    const el = streamArea.value?.querySelector(`[data-pub-id="${pubId}"]`);
    if (el) {
      el.remove();
      console.log('[EVENT] unpublish -> remove DOM', pubId);
      // remoteVideos 配列からも取り除く（厳密さを保つ）
      remoteVideos.value = remoteVideos.value.filter(v => v !== el);
      // もし Set に記録しているなら削除（任意）
      subscribedPublicationIds.delete(pubId);
      console.log('[EVENT] removed remote element (unpublish)', pubId);
    } else {
      console.log('[EVENT] unpublish but no element found', pubId);
    }
  });
    joined.value = true;

    console.log('[JOIN] SUCCESS 状態', {
      Joined: joined.value,
      LocalMemberId: localMember.value?.id,
      RemoteVideoDomCount: remoteVideos.value.length,
      subscribedPublicationIds: [...subscribedPublicationIds]
    });

    // 🔊 ローカル音声トラックで話者検出セットアップ
    try {
      const localAudioTrack = extractTrack(localAudioStream.value, 'audio');
      if (member.id) {
        setupAudioLevel(member.id, localAudioTrack);
        startAudioLevelMonitor();
      }
    } catch (e) {
      console.warn('local audio level setup failed:', e);
    }
  } catch (e) {
    toast.error('ルーム参加に失敗しました: ' + e);
    console.error(e);
  } finally {
    joining.value = false;
  }
};

// 退出（Leave）
const leaveRoom = async () => {
  if (leaving.value) return; // 二重押下防止（追加）
  leaving.value = true;
  // DEBUG: 開始時のメンバー一覧（取得できる範囲）
  console.log('[LEAVE] START', {
    Joined: joined.value,
    LocalMemberId: localMember.value?.id,
    roomMembersSnapshot: context.room?.members?.map(m => m.id)
  });
  try {
    // まず leave を試す（先に leave することでゴーストメンバー化を防止）
    let leaveSucceeded = false;
    if (localMember.value?.leave) {
      try {
        await localMember.value.leave();
        leaveSucceeded = true;
        console.log('[LEAVE] member.leave() 完了');
      } catch (err) {
        console.warn('[LEAVE] member.leave() 失敗 -> フォールバックで unpublish', err);
      }
    } else {
      console.log('[LEAVE] member.leave() 不可 (メソッドなし)');
    }

    // leave が失敗した場合のみ unpublish を試す（成功していれば不要）
    if (!leaveSucceeded && localMember.value?.unpublish) {
      try {
        if (localVideoPublication.value) {
          await localMember.value.unpublish(localVideoPublication.value);
          console.log('[LEAVE][FB] unpublish video', localVideoPublication.value.id);
        }
        if (localAudioPublication.value) {
          await localMember.value.unpublish(localAudioPublication.value);
          console.log('[LEAVE][FB] unpublish audio', localAudioPublication.value.id);
        }
      } catch (e) {
        console.warn('[LEAVE][FB] unpublish failed', e);
      }
    }

    // 追加: 新規配信イベントのハンドラを解除（多重登録/二重subscribe防止）
    if (context.room && roomEventHandlers.onStreamPublished && typeof context.room.onStreamPublished?.remove === 'function') {
      try { 
        context.room.onStreamPublished.remove(roomEventHandlers.onStreamPublished); 
        console.log('[LEAVE] onStreamPublished ハンドラ解除');
      } catch (e) {
        console.warn('[LEAVE] handler remove failed', e);
      }
    }
    roomEventHandlers.onStreamPublished = null;

    // ローカルメディアの解放
    if (localVideoStream.value) {
      try {
        localVideoStream.value.detach?.();
        localVideoStream.value.track?.stop?.();
        console.log('[LEAVE] local video track stopped');
      } catch {}
    }
    if (localAudioStream.value) {
      try {
        localAudioStream.value.detach?.();
        localAudioStream.value.track?.stop?.();
        console.log('[LEAVE] local audio track stopped');
      } catch {}
    }

    // ローカル要素の削除
    if (localVideoEl.value && localVideoEl.value.parentNode) {
      localVideoEl.value.pause?.();
      localVideoEl.value.srcObject = null;
      localVideoEl.value.parentNode.removeChild(localVideoEl.value);
      console.log('[LEAVE] local video element removed');
    }
    localVideoEl.value = null;

    // リモート要素の削除
    const removing = remoteVideos.value.length;
    for (const el of remoteVideos.value) {
      try {
        el.pause?.();
        el.srcObject = null;
        el.remove();
      } catch {}
    }
    remoteVideos.value = [];
    console.log('[LEAVE] remote elements removed', removing);

    // 追加: 映像拡大中なら縮小してオーバーレイを除去
    if (enlargedVideo.value) {
      try { shrinkVideo(); console.log('[LEAVE] shrinkVideo 実行'); } catch {}
    }

    // 追加: 念のため表示領域を完全クリア（取りこぼし対策）
    if (streamArea.value) {
      try { streamArea.value.innerHTML = ''; console.log('[LEAVE] StreamArea cleared'); } catch {}
    }

    // 状態初期化（RoomIdは残す＝再参加しやすくする）
    joined.value = false;
    joining.value = false;
    localMember.value = null;
    localVideoStream.value = null;
    localAudioStream.value = null;

    // ミュート状態初期化（新規追加）
    isAudioMuted.value = false;
    isVideoMuted.value = false;
    isScreenSharing.value = false; // 追加: 画面共有の状態も戻す

    // 追加: Publication 参照をリセット
    localVideoPublication.value = null;
    localAudioPublication.value = null;

    // 追加: subscribe 済み publication の記録をクリア
    subscribedPublicationIds.clear();
    console.log('[LEAVE] subscribedPublicationIds cleared');

    // 🔊 話者検出停止 & クリーンアップ
    stopAudioLevelMonitor();

    // 背景ぼかしプロセッサ破棄
    try { await backgroundProcessor?.dispose?.(); } catch {}
    backgroundProcessor = null;
    isBackgroundBlurred.value = false;

    // NOTE: room インスタンスを null にする前に（デバッグ用に）メンバー確認
    console.log('[LEAVE] room.members snapshot (before null)', context.room?.members?.map(m => m.id));

    // 重要: 同じ Room インスタンスでの再 join を避けるため破棄（追加）
    roomCreated.value = false;
    context.room = null;

    // DEBUG: 終了ログ
    console.log('[LEAVE] END', {
      Joined: joined.value,
      LocalMember: localMember.value,
      RoomCreated: roomCreated.value,
      RemoteVideoDomCount: remoteVideos.value.length
    });
  } catch (e) {
    console.error('leave failed:', e);
  } finally {
    leaving.value = false;
  }
};
// onMounted: URL に room=xxx があれば利用
onMounted(async () => {
  await getContext();
  await loadDevices(); // デバイス選択で追加： デバイス一覧をロード
  const qRoom = new URLSearchParams(window.location.search).get('room');
  if (qRoom) {
    roomId.value = qRoom;
  }
  // デバイスの接続/切断を検知してデバイスリストを更新
  try {
    if (navigator?.mediaDevices && typeof navigator.mediaDevices.addEventListener === 'function') {
      deviceChangeHandler = () => {
        console.log('[DEVICE] devicechange detected, reloading devices');
        loadDevices().catch(err => console.warn('loadDevices failed on devicechange:', err));
      };
      navigator.mediaDevices.addEventListener('devicechange', deviceChangeHandler);
    }
  } catch (e) {
    console.warn('devicechange listener setup failed:', e);
  }
  // ESCキーリスナー追加
  document.addEventListener('keydown', handleKeydown);
});

// クリーンアップ（追加）
onUnmounted(async () => {
  document.removeEventListener('keydown', handleKeydown);
  // devicechange リスナ解除
  try {
    if (navigator?.mediaDevices && deviceChangeHandler && typeof navigator.mediaDevices.removeEventListener === 'function') {
      navigator.mediaDevices.removeEventListener('devicechange', deviceChangeHandler);
      deviceChangeHandler = null;
    }
  } catch (e) {
    console.warn('remove devicechange listener failed:', e);
  }
  // 背景ぼかしのクリーンアップ
  try { await disableBackgroundBlur(); } catch {}
});
</script>

<template>
  <div class="p-4 space-y-4">
    <!-- 拡大表示中の縮小用オーバーレイ -->
    <div v-if="enlargedVideo" @click="shrinkVideo" class="fixed inset-0 bg-transparent z-40 cursor-pointer" />

    <!-- ツールバー（上部固定） -->
    <header class="sticky top-0 z-30 bg-white/90 backdrop-blur px-3 py-2 shadow-sm">
      <div class="flex items-center justify-between gap-2 flex-wrap">
        <!-- 左: ルーム制御 -->
        <div class="flex items-center gap-2">
          <button v-if="!roomCreated" @click="createRoom" class="px-3 py-1.5 rounded bg-blue-600 text-white text-sm hover:bg-blue-700">＋作成</button>
          <button v-if="roomId && !joined" :disabled="joining || leaving" @click="joinRoom" class="px-3 py-1.5 rounded bg-green-600 text-white text-sm hover:bg-green-700 disabled:opacity-50">{{ joining ? '参加中…' : '参加' }}</button>
          <button v-if="joined" :disabled="leaving" @click="leaveRoom" class="px-3 py-1.5 rounded bg-gray-600 text-white text-sm hover:bg-gray-700 disabled:opacity-50">{{ leaving ? '退出中…' : '退出' }}</button>
        </div>

        <!-- 中央: メディア操作（参加時のみ） -->
        <div v-if="joined" class="flex items-center gap-2">
          <button @click="toggleAudioMute" :title="isAudioMuted ? 'ミュート解除' : 'ミュート'" :class="['px-3 py-1.5 rounded text-sm', isAudioMuted ? 'bg-red-600 text-white' : 'bg-blue-600 text-white']">ミュート🎤</button>
          <button @click="toggleVideoMute" :title="isVideoMuted ? '映像ON' : '映像OFF'" :class="['px-3 py-1.5 rounded text-sm', isVideoMuted ? 'bg-red-600 text-white' : 'bg-blue-600 text-white']">映像📹</button>
          <button @click="screenShare" :title="isScreenSharing ? '共有停止' : '画面共有'" :class="['px-3 py-1.5 rounded text-sm', isScreenSharing ? 'bg-red-600 text-white' : 'bg-blue-600 text-white']">画面共有🖥️</button>
          <button @click="toggleBackgroundBlur" :title="'背景ぼかし'" :class="['px-3 py-1.5 rounded text-sm', isBackgroundBlurred ? 'bg-purple-600 text-white' : 'bg-blue-600 text-white']">ぼかし🟣</button>
          <button @click="toggleRnnoise" :title="'ノイズ抑制(RNNoise)'" :class="['px-3 py-1.5 rounded text-sm', isRnnoiseEnabled ? 'bg-purple-600 text-white' : 'bg-purple-200 text-purple-900']">ノイズ抑制</button>
        </div>

        <!-- 右: 設定メニュー -->
        <div class="relative">
          <button @click="showSettingsOpen = !showSettingsOpen" class="px-3 py-1.5 rounded bg-gray-100 text-sm hover:bg-gray-200" title="設定">⋮</button>
          <div v-if="showSettingsOpen" class="absolute right-0 mt-2 w-48 bg-white border rounded shadow z-40">
            <button class="w-full text-left px-3 py-2 text-sm hover:bg-gray-50" @click="openCameraPanel(); showSettingsOpen=false">カメラ切替</button>
            <button class="w-full text-left px-3 py-2 text-sm hover:bg-gray-50" @click="openMicPanel(); showSettingsOpen=false">マイク切替</button>
            <button class="w-full text-left px-3 py-2 text-sm hover:bg-gray-50" @click="openSpeakerPanel(); showSettingsOpen=false">スピーカー切替</button>
          </div>
        </div>
      </div>
      <div v-if="errorMessage" class="mt-2 text-xs text-red-600">{{ errorMessage }}</div>
    </header>

    <!-- デバイス選択パネル（ボタンは設定メニューから開く） -->
    <div v-if="showCameraPanel" class="mt-2 p-3 bg-white border rounded shadow absolute z-50">
      <div class="flex items-center gap-2">
        <select v-model="tempSelectedVideoInputId" class="px-3 py-2 rounded border text-sm">
          <option v-for="d in videoInputDevices" :key="d.deviceId" :value="d.deviceId">{{ d.label || d.deviceId }}</option>
        </select>
        <button @click="confirmCameraPanel" class="px-3 py-1 bg-green-600 text-white rounded text-sm">確定</button>
        <button @click="cancelCameraPanel" class="px-3 py-1 bg-gray-300 rounded text-sm">キャンセル</button>
      </div>
    </div>
    <div v-if="showMicPanel" class="mt-2 p-3 bg-white border rounded shadow absolute z-50">
      <div class="flex items-center gap-2">
        <select v-model="tempSelectedAudioInputId" class="px-3 py-2 rounded border text-sm">
          <option v-for="d in audioInputDevices" :key="d.deviceId" :value="d.deviceId">{{ d.label || d.deviceId }}</option>
        </select>
        <button @click="confirmMicPanel" class="px-3 py-1 bg-green-600 text-white rounded text-sm">確定</button>
        <button @click="cancelMicPanel" class="px-3 py-1 bg-gray-300 rounded text-sm">キャンセル</button>
      </div>
    </div>
    <div v-if="showSpeakerPanel" class="mt-2 p-3 bg-white border rounded shadow absolute z-50">
      <div class="flex items-center gap-2">
        <select v-model="tempSelectedAudioOutputId" class="px-3 py-2 rounded border text-sm">
          <option v-for="d in audioOutputDevices" :key="d.deviceId" :value="d.deviceId">{{ d.label || d.deviceId }}</option>
        </select>
        <button @click="confirmSpeakerPanel" class="px-3 py-1 bg-green-600 text-white rounded text-sm">確定</button>
        <button @click="cancelSpeakerPanel" class="px-3 py-1 bg-gray-300 rounded text-sm">キャンセル</button>
      </div>
    </div>

    <!-- URL共有（折りたたみ） -->
    <div v-if="roomId" class="space-y-2 text-sm">
      <button @click="showShareOpen = !showShareOpen" class="px-3 py-1.5 rounded bg-gray-100 hover:bg-gray-200 text-sm">URL共有 {{ showShareOpen ? '▲' : '▼' }}</button>
      <div v-if="showShareOpen" class="space-y-2">
        <p class="text-xs text-gray-600">以下のURLを相手と共有:</p>
        <p class="break-all font-mono bg-gray-100 px-2 py-1 rounded">{{ baseUrl }}?room={{ roomId }}</p>
        <p class="text-xs text-gray-600">またはルームID:</p>
        <p class="font-mono bg-gray-100 px-2 py-1 inline-block rounded">{{ roomId }}</p>
      </div>
    </div>

    <!-- 映像表示エリア（固定高 + 内側スクロール、グリッド） -->
    <div
      ref="streamArea"
      v-if="roomCreated"
      class="border rounded p-3 max-h-[65vh] overflow-y-auto"
      style="display:grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px;"
    />
    <div v-else class="text-gray-500 italic">まだルームは作成されていません。</div>
  </div>
</template>
