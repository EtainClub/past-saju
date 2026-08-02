# 과거사주 — 가지 않은 운

과거를 맞히는 사주가 아니라, 지나온 선택을 통해 지금의 나를 이해하는 사주 경험입니다. 과거의 한 갈림길을 입력하면 사주에서 파생된 서로 다른 세 축을 카드로 봉인하고, 사용자가 고른 한 장의 이후 3년을 보여 줍니다.

## 실행

```bash
pnpm install --frozen-lockfile
pnpm dev
```

검증 명령:

```bash
pnpm lint
pnpm exec tsc --noEmit
pnpm test
pnpm build
```

Node.js 22 이상이 필요합니다. 이 작업 환경은 Android/ARM64라 Turbopack 네이티브 바인딩을 사용할 수 없으므로 개발·프로덕션 빌드에 Next.js 16의 Webpack 플래그를 사용합니다.

## Firebase

운영 환경의 API Route는 Firebase Admin SDK로 Firestore에 연결합니다. 브라우저에서 Firestore를 직접 읽거나 쓰지 않으며, 배포된 보안 규칙도 모든 클라이언트 접근을 차단합니다.

로컬에서 실제 프로젝트를 사용할 때는 Application Default Credentials(ADC)를 준비하고 저장소를 선택합니다.

```bash
gcloud auth application-default login
# .env.local
FIREBASE_STORAGE_BACKEND=firestore
NEXT_PUBLIC_FIREBASE_PROJECT_ID=pastsaju
```

ADC와 실제 Firestore 쓰기·읽기·정리 연결은 다음 명령으로 확인합니다.

```bash
pnpm test:firebase
```

서비스 계정을 사용하는 배포 환경에서는 한 줄짜리 JSON을 `FIREBASE_SERVICE_ACCOUNT_JSON`에 넣을 수 있습니다. Google Cloud 및 Firebase App Hosting 환경에서는 ADC를 사용하므로 서비스 계정 키 파일을 저장소에 추가하지 않습니다.

Firestore 에뮬레이터를 쓰면 실제 프로젝트 데이터를 건드리지 않고 저장 흐름을 확인할 수 있습니다.

```bash
firebase emulators:start --only firestore
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 pnpm dev
```

규칙·인덱스와 7일 만료 문서의 TTL 설정은 다음 명령으로 배포합니다.

```bash
firebase deploy --only firestore:rules,firestore:indexes --project pastsaju
gcloud firestore fields ttls update expiresAt --collection-group=readingSessions --enable-ttl --project=pastsaju --database='(default)'
gcloud firestore fields ttls update expiresAt --collection-group=readingFeedback --enable-ttl --project=pastsaju --database='(default)'
```

개발 환경은 Firebase 변수가 없으면 메모리 저장소로 동작합니다. 운영 환경은 Firestore 연결 실패 시 메모리로 조용히 대체하지 않고 503을 반환합니다.

## 현재 구현

- 만 14세 이상 연령 게이트
- 출생 정보 브라우저 캐시와 KASI 정본 절기표 기반 원국·십신·대운·진태양시 계산
- 사건 프리셋, 필수 서술 1개, 선택 서술, 세 개의 상황 척도
- 고위험 사건의 생성 전 차단과 상담 연락처 안내
- 십신 축 기반 세 카드 및 SHA-256 봉인 검증
- 선택하지 않은 카드 문구를 클라이언트에 전송하지 않는 서버 세션
- NDJSON 스트리밍으로 순차 공개되는 3개월·1년·3년 서사
- 득실, 공통 과제, 계산 근거, 불확실성 고지, 결과 평가
- 360px 모바일 레이아웃, 키보드 포커스, 축소 모션·축소 투명도·고대비 대응

세션·선택 상태·피드백은 Firestore에 저장되며, 카드 선택과 중복 피드백은 트랜잭션으로 보호됩니다. 세션 및 피드백 문서는 생성 7일 뒤 만료되고 TTL 정책에 따라 자동 삭제됩니다. App Check와 모델 예산 킬스위치는 배포 전 후속 작업입니다.
