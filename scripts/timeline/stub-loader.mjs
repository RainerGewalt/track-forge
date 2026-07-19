// Node loader hook: @strudel/core's dist entry imports the browser-only
// @kabelsalat/web package; stub it so patterns can be evaluated offline.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@kabelsalat/web') {
    return { url: 'data:text/javascript,export class SalatRepl {}', shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
