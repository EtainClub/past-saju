# 앱인토스 심사 제출물

앱인토스 콘솔의 **노출 정보**에 올리는 파일입니다.

| 파일 | 규격 | 용도 |
| --- | --- | --- |
| `app-logo-light-600.png` | 600×600 | 앱 로고 |
| `app-logo-dark-600.png` | 600×600 | 다크모드 앱 로고 |
| `screenshot-1-landing.png` | 636×1048 | 스크린샷 ① 랜딩 |
| `screenshot-2-chart.png` | 636×1048 | 스크린샷 ② 내 사주 |
| `screenshot-3-form.png` | 636×1048 | 스크린샷 ③ 갈림길 입력 |

## 만드는 법

**로고** — `scripts/toss-assets.tsx`가 생성합니다.

```bash
npx tsc scripts/toss-assets.tsx --outDir .test-dist --module commonjs \
  --moduleResolution node --target ES2020 --lib ES2022,DOM \
  --esModuleInterop --skipLibCheck --jsx react-jsx
node .test-dist/toss-assets.js
```

파비콘(`src/app/icon.svg`)·OG 이미지와 **같은 마크**를 씁니다 — 원, 세 획,
중심점. 세 획은 갈림길이고 중심점은 고른 하나입니다. 마크가 다르면 앱
목록에서 같은 서비스로 안 보입니다.

**스크린샷** — 배포된 `ifsaju.com`을 **실제로 캡처**했습니다. 그리면 실물과
달라지고, 심사와 사용자 기대가 어긋납니다.

브라우저 창이 1048px까지 안 커져서 전체 페이지로 찍은 뒤 규격에 맞춰
잘랐습니다. 내 사주 화면은 내용이 997px라 51px 모자라, 페이지 배경색
(`#151514`)으로 아래를 채웠습니다 — 없는 내용을 지어내지 않는 캔버스
확장입니다.

```bash
sips -c 1048 636 --cropOffset 0 0 <파일>       # 위 기준 자르기
sips -p 1048 636 --padColor 151514 <파일>      # 모자란 만큼 배경색 채우기
```

## 다시 찍어야 할 때

화면을 바꾸면 스크린샷도 낡습니다. 특히 하단 탭·「내 사주」·입력 예시는
최근에 추가된 것이라, 이후 UI를 손대면 여기도 함께 갱신해야 합니다.
