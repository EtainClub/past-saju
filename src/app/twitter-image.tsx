import { createSocialImage, socialImageSize } from "./social-image";

export const alt = "만약사주 — 그때 그 선택, 아직도 후회되나요.";
export const size = socialImageSize;
export const contentType = "image/png";
// 내용이 입력에 따라 변하지 않는 브랜드 이미지다. 정적 내보내기(토스 빌드)에서도
// 생성되도록 명시한다 — 없으면 export 가 실패한다.
export const dynamic = "force-static";

export default function TwitterImage() {
  return createSocialImage();
}
