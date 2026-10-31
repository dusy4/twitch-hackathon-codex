// Standalone entry point for the same pure tests used by LiveSelfTest.Run().
// Compile with Unity's references and run under Unity's Mono; no editor opens.
public static class CoreCheck
{
    public static void Main()
    {
        RaidRift.EditorTools.LiveSelfTest.Core();
        System.Console.WriteLine("PASS: ring overflow/wrap/concurrency, resampling, crop");
    }
}
