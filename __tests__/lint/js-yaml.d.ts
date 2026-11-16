// Minimalne typy js-yaml 4 dla testu workflow (#201). Bez @types/js-yaml: jedna nowa
// devDependency (js-yaml), żadnych innych paczek. Tylko `load` (schemat domyślny) i typ błędu.
declare module "js-yaml" {
  export class YAMLException extends Error {}
  export function load(input: string): unknown;
}
