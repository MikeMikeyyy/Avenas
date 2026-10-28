// The blurred top of most pages draws its fade through
// @react-native-masked-view/masked-view. Its types (0.3.2, its latest) build the
// view on a React Native type that 0.88 removed (`NativeMethods`), which breaks
// it as a JSX component under SDK 58's stricter types. This is the library's
// own view, given its props' type again: import MaskedView from here, and go
// back to the package itself once it ships types for React Native 0.88.

import type { ComponentType, ReactElement } from "react";
import type { ViewProps } from "react-native";
import LibraryMaskedView from "@react-native-masked-view/masked-view";

type MaskedViewProps = ViewProps & {
  maskElement: ReactElement;
  androidRenderingMode?: "software" | "hardware";
};

const MaskedView = LibraryMaskedView as unknown as ComponentType<MaskedViewProps>;
export default MaskedView;
