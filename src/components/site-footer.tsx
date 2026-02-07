export function SiteFooter() {
  return (
    <footer className="border-t py-6 text-center text-sm text-muted-foreground">
      <div className="container mx-auto px-4">
        <p>&copy; {new Date().getFullYear()} MyHelper. Wszelkie prawa zastrzezone.</p>
      </div>
    </footer>
  );
}
