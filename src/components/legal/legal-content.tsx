import { Fragment } from "react";
import Link from "next/link";
import type {
  LegalBlock,
  LegalInline,
  LegalList,
  LegalTableRow,
} from "@/lib/legal/markdown";

/**
 * Renderuje treść dokumentu prawnego ze struktury `parseLegalMarkdown`.
 * Tylko elementy React z tekstem — bez surowego HTML.
 */
export function LegalContent({ blocks }: { blocks: readonly LegalBlock[] }) {
  return (
    <div className="mt-8 space-y-4 text-sm leading-relaxed md:text-base">
      {blocks.map((block, index) => (
        <Block key={index} block={block} />
      ))}
    </div>
  );
}

function Block({ block }: { block: LegalBlock }) {
  switch (block.type) {
    case "heading":
      return block.level === 2 ? (
        <h2 className="pt-6 text-xl font-semibold tracking-tight md:text-2xl">
          <Inline nodes={block.content} />
        </h2>
      ) : (
        <h3 className="pt-3 text-lg font-semibold">
          <Inline nodes={block.content} />
        </h3>
      );
    case "paragraph":
      return (
        <p>
          <Inline nodes={block.content} />
        </p>
      );
    case "list":
      return <List list={block} />;
    case "table":
      return <Table header={block.header} rows={block.rows} />;
    case "rule":
      return <hr className="my-8 border-border" />;
  }
}

function List({ list }: { list: LegalList }) {
  const items = list.items.map((item, index) => (
    <li key={index} value={item.value ?? undefined} className="pl-1">
      <Inline nodes={item.content} />
      {item.children !== null && <List list={item.children} />}
    </li>
  ));
  return list.ordered ? (
    <ol className="list-decimal space-y-2 pl-6">{items}</ol>
  ) : (
    <ul className="list-disc space-y-2 pl-6">{items}</ul>
  );
}

function Table({ header, rows }: { header: LegalTableRow; rows: readonly LegalTableRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr>
            {header.map((cell, index) => (
              <th key={index} className="border border-border bg-muted px-3 py-2 align-top font-semibold">
                <Inline nodes={cell} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="border border-border px-3 py-2 align-top">
                  <Inline nodes={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Inline({ nodes }: { nodes: readonly LegalInline[] }) {
  return (
    <>
      {nodes.map((node, index) => {
        switch (node.type) {
          case "text":
            return <Fragment key={index}>{node.text}</Fragment>;
          case "strong":
            return (
              <strong key={index} className="font-semibold">
                <Inline nodes={node.children} />
              </strong>
            );
          case "code":
            return (
              <code key={index} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">
                {node.text}
              </code>
            );
          case "link":
            return (
              <Link key={index} href={node.href} className="text-primary underline underline-offset-4">
                <Inline nodes={node.children} />
              </Link>
            );
          case "break":
            return <br key={index} />;
        }
      })}
    </>
  );
}
