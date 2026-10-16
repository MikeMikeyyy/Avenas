// constants/tabIcons.ts
//
// The tab bar's icons as drawings: a viewBox and the shapes in it, painted in
// one colour. The app's own bar draws them with react-native-svg
// (components/DrawnIcon.tsx). Apple's bar, which the app shows on iOS 26 and
// later (app/(tabs)/_layout.tsx), can only show images, so
// scripts/build-tab-icons.ts renders these same drawings into
// assets/images/tab-icons/. After changing a drawing, run
//
//   npx tsx scripts/build-tab-icons.ts
//
// or Apple's bar keeps showing the old icon.
//
// Plain data with no React Native in it, so the script can read it in Node.

/** A drawing in one colour: stroked at `stroke.width` (with round ends and
 *  corners when `round`), or filled when there's no `stroke`. */
export type IconDrawing = {
  viewBox: string;
  stroke?: { width: number; round?: boolean };
  paths: string[];
  circles?: { cx: number; cy: number; r: number }[];
};

/** The size a tab icon is drawn at, in points, in either bar. */
export const TAB_ICON_SIZE = 24;

export const HOME_ICON: IconDrawing = {
  viewBox: "0 0 256 256",
  paths: [
    "M219.31,108.68l-80-80a16,16,0,0,0-22.62,0l-80,80A15.87,15.87,0,0,0,32,120v96a8,8,0,0,0,8,8h64a8,8,0,0,0,8-8V160h32v56a8,8,0,0,0,8,8h64a8,8,0,0,0,8-8V120A15.87,15.87,0,0,0,219.31,108.68ZM208,208H160V152a8,8,0,0,0-8-8H104a8,8,0,0,0-8,8v56H48V120l80-80,80,80Z",
  ],
};

/** The app's one dumbbell, drawn everywhere by components/DumbbellIcon.tsx. */
export const DUMBBELL_ICON: IconDrawing = {
  viewBox: "0 0 24 24",
  stroke: { width: 1.5 },
  paths: [
    "M15.5 9L15.5 15C15.5 15.465 15.5 15.6975 15.5511 15.8882C15.6898 16.4059 16.0941 16.8102 16.6118 16.9489C16.8025 17 17.035 17 17.5 17C17.965 17 18.1975 17 18.3882 16.9489C18.9059 16.8102 19.3102 16.4059 19.4489 15.8882C19.5 15.6975 19.5 15.465 19.5 15V9C19.5 8.53501 19.5 8.30252 19.4489 8.11177C19.3102 7.59413 18.9059 7.18981 18.3882 7.05111C18.1975 7 17.965 7 17.5 7C17.035 7 16.8025 7 16.6118 7.05111C16.0941 7.18981 15.6898 7.59413 15.5511 8.11177C15.5 8.30252 15.5 8.53501 15.5 9Z",
    "M4.5 9L4.5 15C4.5 15.465 4.5 15.6975 4.55111 15.8882C4.68981 16.4059 5.09413 16.8102 5.61177 16.9489C5.80252 17 6.03501 17 6.5 17C6.96499 17 7.19748 17 7.38823 16.9489C7.90587 16.8102 8.31019 16.4059 8.44889 15.8882C8.5 15.6975 8.5 15.465 8.5 15V9C8.5 8.53501 8.5 8.30252 8.44889 8.11177C8.31019 7.59413 7.90587 7.18981 7.38823 7.05111C7.19748 7 6.96499 7 6.5 7C6.03501 7 5.80252 7 5.61177 7.05111C5.09413 7.18981 4.68981 7.59413 4.55111 8.11177C4.5 8.30252 4.5 8.53501 4.5 9Z",
    "M5 10H4C2.89543 10 2 10.8954 2 12C2 13.1046 2.89543 14 4 14H5M9 12H15M19 14H20C21.1046 14 22 13.1046 22 12C22 10.8954 21.1046 10 20 10H19",
  ],
};

export const PROGRESS_ICON: IconDrawing = {
  viewBox: "0 0 24 24",
  stroke: { width: 2, round: true },
  paths: ["M3 3v16a2 2 0 0 0 2 2h16", "M18 17V9", "M13 17V5", "M8 17v-3"],
};

export const USERS_ICON: IconDrawing = {
  viewBox: "0 0 24 24",
  stroke: { width: 2, round: true },
  paths: [
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",
    "M16 3.128a4 4 0 0 1 0 7.744",
    "M22 21v-2a4 4 0 0 0-3-3.87",
  ],
  circles: [{ cx: 9, cy: 7, r: 4 }],
};

/** The Trainer tab's previous icon, kept so it can be switched back in
 *  TAB_ICONS if the users icon doesn't stick. */
export const COMMUNITY_ICON: IconDrawing = {
  viewBox: "0 0 24 24",
  paths: [
    "M9.15957 11.62C9.12957 11.62 9.10957 11.62 9.07957 11.62C9.02957 11.61 8.95957 11.61 8.89957 11.62C5.99957 11.53 3.80957 9.25 3.80957 6.44C3.80957 3.58 6.13957 1.25 8.99957 1.25C11.8596 1.25 14.1896 3.58 14.1896 6.44C14.1796 9.25 11.9796 11.53 9.18957 11.62C9.17957 11.62 9.16957 11.62 9.15957 11.62ZM8.99957 2.75C6.96957 2.75 5.30957 4.41 5.30957 6.44C5.30957 8.44 6.86957 10.05 8.85957 10.12C8.91957 10.11 9.04957 10.11 9.17957 10.12C11.1396 10.03 12.6796 8.42 12.6896 6.44C12.6896 4.41 11.0296 2.75 8.99957 2.75Z",
    "M16.5396 11.75C16.5096 11.75 16.4796 11.75 16.4496 11.74C16.0396 11.78 15.6196 11.49 15.5796 11.08C15.5396 10.67 15.7896 10.3 16.1996 10.25C16.3196 10.24 16.4496 10.24 16.5596 10.24C18.0196 10.16 19.1596 8.96 19.1596 7.49C19.1596 5.97 17.9296 4.74 16.4096 4.74C15.9996 4.75 15.6596 4.41 15.6596 4C15.6596 3.59 15.9996 3.25 16.4096 3.25C18.7496 3.25 20.6596 5.16 20.6596 7.5C20.6596 9.8 18.8596 11.66 16.5696 11.75C16.5596 11.75 16.5496 11.75 16.5396 11.75Z",
    "M9.16961 22.55C7.20961 22.55 5.23961 22.05 3.74961 21.05C2.35961 20.13 1.59961 18.87 1.59961 17.5C1.59961 16.13 2.35961 14.86 3.74961 13.93C6.74961 11.94 11.6096 11.94 14.5896 13.93C15.9696 14.85 16.7396 16.11 16.7396 17.48C16.7396 18.85 15.9796 20.12 14.5896 21.05C13.0896 22.05 11.1296 22.55 9.16961 22.55ZM4.57961 15.19C3.61961 15.83 3.09961 16.65 3.09961 17.51C3.09961 18.36 3.62961 19.18 4.57961 19.81C7.06961 21.48 11.2696 21.48 13.7596 19.81C14.7196 19.17 15.2396 18.35 15.2396 17.49C15.2396 16.64 14.7096 15.82 13.7596 15.19C11.2696 13.53 7.06961 13.53 4.57961 15.19Z",
    "M18.3397 20.75C17.9897 20.75 17.6797 20.51 17.6097 20.15C17.5297 19.74 17.7897 19.35 18.1897 19.26C18.8197 19.13 19.3997 18.88 19.8497 18.53C20.4197 18.1 20.7297 17.56 20.7297 16.99C20.7297 16.42 20.4197 15.88 19.8597 15.46C19.4197 15.12 18.8697 14.88 18.2197 14.73C17.8197 14.64 17.5597 14.24 17.6497 13.83C17.7397 13.43 18.1397 13.17 18.5497 13.26C19.4097 13.45 20.1597 13.79 20.7697 14.26C21.6997 14.96 22.2297 15.95 22.2297 16.99C22.2297 18.03 21.6897 19.02 20.7597 19.73C20.1397 20.21 19.3597 20.56 18.4997 20.73C18.4397 20.75 18.3897 20.75 18.3397 20.75Z",
  ],
};

/** Each tab's icon, by its route name. The image files Apple's bar shows are
 *  named the same (assets/images/tab-icons/<route>.png). */
export const TAB_ICONS: Record<string, IconDrawing> = {
  home: HOME_ICON,
  workout: DUMBBELL_ICON,
  progress: PROGRESS_ICON,
  "trainer-hub": USERS_ICON,
};
