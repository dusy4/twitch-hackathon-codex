using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.XR.ARFoundation;
using Unity.XR.CoreUtils;
namespace RaidRift.Editor {
 public static class BuildProject {
  [MenuItem("RaidRift/Create AR capture scene")]
  public static void CreateScene(){var scene=EditorSceneManager.NewScene(NewSceneSetup.EmptyScene,NewSceneMode.Single);var session=new GameObject("AR Session").AddComponent<ARSession>();session.enabled=false;var origin=new GameObject("XR Origin").AddComponent<XROrigin>();var cameraObject=new GameObject("AR Camera");cameraObject.tag="MainCamera";cameraObject.transform.SetParent(origin.transform);var camera=cameraObject.AddComponent<Camera>();origin.Camera=camera;cameraObject.AddComponent<AudioListener>();var manager=cameraObject.AddComponent<ARCameraManager>();manager.enabled=false;cameraObject.AddComponent<ARCameraBackground>();var occlusion=cameraObject.AddComponent<AROcclusionManager>();occlusion.enabled=false;var planes=origin.gameObject.AddComponent<ARPlaneManager>();planes.enabled=false;var raycasts=origin.gameObject.AddComponent<ARRaycastManager>();raycasts.enabled=false;var anchors=origin.gameObject.AddComponent<ARAnchorManager>();anchors.enabled=false;var world=origin.gameObject.AddComponent<ArWorld>();world.arCamera=camera;world.planes=planes;world.raycasts=raycasts;world.anchors=anchors;world.occlusion=occlusion;var publisher=origin.gameObject.AddComponent<CompositePublisher>();publisher.world=world;var consent=origin.gameObject.AddComponent<ConsentPanel>();consent.world=world;consent.publisher=publisher;System.IO.Directory.CreateDirectory("Assets/Scenes");EditorSceneManager.SaveScene(scene,"Assets/Scenes/RaidRift.unity");EditorBuildSettings.scenes=new[]{new EditorBuildSettingsScene("Assets/Scenes/RaidRift.unity",true)};PlayerSettings.companyName="RaidRift";PlayerSettings.productName="RaidRift Capture";PlayerSettings.SetApplicationIdentifier(BuildTargetGroup.Android,"world.raidrift.capture");PlayerSettings.Android.minSdkVersion=AndroidSdkVersions.AndroidApiLevel26;PlayerSettings.iOS.cameraUsageDescription="Anchor your virtual RaidRift world to visible surfaces.";AssetDatabase.SaveAssets();}
  public static void Android(){CreateScene();BuildPipeline.BuildPlayer(EditorBuildSettings.scenes,"Build/RaidRift.apk",BuildTarget.Android,BuildOptions.Development);}
 }
}
