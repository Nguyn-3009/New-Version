"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = withSnapbackValidation;
var _react = _interopRequireDefault(require("react"));
function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
function withSnapbackValidation(Component) {
  return props => {
    const childrenCount = _react.default.Children.count(props.children);
    if (childrenCount !== 1) {
      const message = `SnapbackZoom expected one child but received ${childrenCount} children`;
      throw new Error(message);
    }
    if (props.longPressDuration !== undefined && props.longPressDuration <= 250) {
      throw new Error('longPressDuration must be greater than 250ms');
    }
    return /*#__PURE__*/_react.default.createElement(Component, props);
  };
}
//# sourceMappingURL=withSnapbackValidation.js.map