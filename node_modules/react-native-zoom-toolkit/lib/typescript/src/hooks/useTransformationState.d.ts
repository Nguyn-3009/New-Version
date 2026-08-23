import { type SharedValue } from 'react-native-reanimated';
import type { SnapbackZoomState } from '../components/snapback/types';
import type { CropZoomState } from '../components/crop/types';
import type { CommonZoomState } from '../commons/types';
type SharedNumber = SharedValue<number>;
type ComponentSelection = 'resumable' | 'snapback' | 'crop';
type StateSelection<C extends ComponentSelection, T> = C extends 'snapback' ? SnapbackZoomState<T> : C extends 'crop' ? CropZoomState<T> : CommonZoomState<T>;
type TransformNames = 'matrix' | 'translateX' | 'translateY';
type Matrix4x4 = [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number
];
type Transformations = {
    [Name in TransformNames]: Name extends 'matrix' ? Matrix4x4 : number;
};
type Transforms3d = Pick<Transformations, 'matrix'> | Pick<Transformations, 'translateX'> | Pick<Transformations, 'translateY'>;
type TransformationState<T extends ComponentSelection> = {
    onUpdate: (state: StateSelection<T, number>) => void;
    state: StateSelection<T, SharedNumber>;
    transform: Readonly<SharedValue<Transforms3d[]>>;
};
export declare const useTransformationState: <T extends ComponentSelection>(param: T) => TransformationState<T>;
export {};
//# sourceMappingURL=useTransformationState.d.ts.map