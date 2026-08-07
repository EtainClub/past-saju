import { createSocialImage, socialImageSize } from "./social-image";

export const alt = "만약사주 — 그때, 다른 길을 걸었다면.";
export const size = socialImageSize;
export const contentType = "image/png";

export default function TwitterImage() {
  return createSocialImage();
}
