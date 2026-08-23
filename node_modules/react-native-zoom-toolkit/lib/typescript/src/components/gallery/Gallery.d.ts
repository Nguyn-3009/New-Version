import React from 'react';
import { type GalleryProps, type GalleryRefType } from './types';
type GalleryPropsWithRef<T> = GalleryProps<T> & {
    reference?: React.ForwardedRef<GalleryRefType>;
};
declare const Gallery: <T>(props: GalleryPropsWithRef<T>) => JSX.Element;
export default Gallery;
//# sourceMappingURL=Gallery.d.ts.map