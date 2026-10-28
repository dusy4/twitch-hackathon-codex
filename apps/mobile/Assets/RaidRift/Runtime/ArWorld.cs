using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Networking;
using UnityEngine.XR.ARFoundation;
using UnityEngine.XR.ARSubsystems;
using Unity.XR.CoreUtils;
namespace RaidRift {
 public sealed class ArWorld : MonoBehaviour {
  public Camera arCamera; public ARRaycastManager raycasts; public ARAnchorManager anchors; public ARPlaneManager planes; public AROcclusionManager occlusion;
  public string server="https://localhost:3000", token="", room="";
  public string Status {get;private set;}="Camera consent required. No world anchor placed.";
  public bool Consented {get;private set;}
  readonly List<ARRaycastHit> hits=new(); readonly Dictionary<string,GameObject> actors=new();
  ARAnchor anchor; GameObject content,portal; Coroutine polling; WorldState state; bool placing;
  public IEnumerator EnableCapture(){
   if(Consented)yield break;
   yield return Application.RequestUserAuthorization(UserAuthorization.WebCam);
   if(!Application.HasUserAuthorization(UserAuthorization.WebCam)){Status="Camera permission denied";yield break;}
   if(ARSession.state==ARSessionState.None)yield return ARSession.CheckAvailability();
   if(ARSession.state==ARSessionState.NeedsInstall)yield return ARSession.Install();
   if(ARSession.state==ARSessionState.Unsupported){Status="AR unsupported. Use the labelled desktop 2.5D companion.";yield break;}
   Consented=true;FindFirstObjectByType<ARSession>().enabled=true;arCamera.GetComponent<ARCameraManager>().enabled=true;
   planes.enabled=true;raycasts.enabled=true;anchors.enabled=true;
   if(occlusion!=null){occlusion.enabled=true;occlusion.requestedEnvironmentDepthMode=EnvironmentDepthMode.Fastest;}
   Status="Move slowly to find a surface. Tap the ground to anchor your rift.";
   polling=StartCoroutine(Poll());
  }
  void Update(){
   if(!Consented)return;
   if(ARSession.state!=ARSessionState.SessionTracking){Status="Tracking limited — hold still. Virtual world paused locally.";if(content)content.SetActive(false);return;}
   if(content)content.SetActive(state?.config?.paused!=true);
   if(Input.touchCount>0&&Input.GetTouch(0).phase==TouchPhase.Began&&Input.GetTouch(0).position.y<Screen.height*.66f&&!placing&&anchor==null)Place(Input.GetTouch(0).position);
   if(anchor&&state?.avatars!=null){foreach(var a in state.avatars){if(!actors.TryGetValue(a.id,out var actor)){actor=VoxelActor(a);actor.transform.SetParent(content.transform,false);actors.Add(a.id,actor);}var target=new Vector3((a.x-.5f)*2.4f,0,(a.y-.75f)*2f);actor.transform.localPosition=Vector3.Lerp(actor.transform.localPosition,target,Time.deltaTime*10);var animate=actor.GetComponent<AvatarMotion>();animate.motion=a.animation;animate.reduced=state.config.reducedMotion;}var valid=new HashSet<string>();foreach(var a in state.avatars)valid.Add(a.id);var remove=new List<string>();foreach(var pair in actors)if(!valid.Contains(pair.Key)){Destroy(pair.Value);remove.Add(pair.Key);}foreach(var id in remove)actors.Remove(id);if(portal)portal.SetActive(state.raid!=null&&!state.config.paused);}
  }
  async void Place(Vector2 point){
   if(!raycasts.Raycast(point,hits,TrackableType.PlaneWithinPolygon))return;placing=true;
   try {var result=await anchors.TryAddAnchorAsync(hits[0].pose);if(result.status.IsSuccess()){anchor=result.value;content=new GameObject("RaidRift anchored content");content.transform.SetParent(anchor.transform,false);portal=MakePortal();portal.transform.SetParent(content.transform,false);Status="World anchored. "+(occlusion&&occlusion.currentEnvironmentDepthMode!=EnvironmentDepthMode.Disabled?"Depth occlusion active":"Depth unavailable — no surface occlusion");}else Status="Could not create an anchor. Try another surface.";}catch(Exception e){Status="Anchor failed: "+e.GetType().Name;}finally{placing=false;}
  }
  IEnumerator Poll(){while(Consented){if(string.IsNullOrWhiteSpace(token)){Status="Pair with Creator Studio before joining a world.";yield return new WaitForSeconds(1);continue;}using var request=UnityWebRequest.Get(server.TrimEnd('/')+"/v1/native/world");request.SetRequestHeader("Authorization","Bearer "+token);request.timeout=5;yield return request.SendWebRequest();if(request.result==UnityWebRequest.Result.Success){try{state=JsonUtility.FromJson<WorldState>(request.downloadHandler.text);}catch{Status="Invalid world snapshot";}}else{Status="World connection lost: "+request.responseCode;if(request.responseCode==401||request.responseCode==403){StopCapture();yield break;}}yield return new WaitForSeconds(.1f);}}
  public void StopCapture(){Consented=false;if(polling!=null)StopCoroutine(polling);polling=null;if(content)Destroy(content);if(anchor)Destroy(anchor.gameObject);anchor=null;actors.Clear();planes.enabled=false;raycasts.enabled=false;anchors.enabled=false;if(occlusion)occlusion.enabled=false;arCamera.GetComponent<ARCameraManager>().enabled=false;FindFirstObjectByType<ARSession>().enabled=false;GetComponent<CompositePublisher>()?.StopPublishing();Status="Camera and media stopped. No frames retained.";}
  static GameObject Cube(Transform parent,Vector3 pos,Vector3 scale,Color color){var go=GameObject.CreatePrimitive(PrimitiveType.Cube);Destroy(go.GetComponent<Collider>());go.transform.SetParent(parent,false);go.transform.localPosition=pos;go.transform.localScale=scale;var mat=new Material(Shader.Find("Universal Render Pipeline/Lit")??Shader.Find("Standard"));mat.color=color;go.GetComponent<Renderer>().material=mat;return go;}
  static GameObject VoxelActor(AvatarState a){var root=new GameObject("Virtual avatar");ColorUtility.TryParseHtmlString(a.color,out var color);Cube(root.transform,new Vector3(0,.10f,0),new Vector3(.07f,.09f,.05f),color);Cube(root.transform,new Vector3(0,.18f,0),Vector3.one*.07f,new Color(.94f,.76f,.63f));for(int i=0;i<2;i++)Cube(root.transform,new Vector3(i==0?-.025f:.025f,.03f,0),new Vector3(.025f,.06f,.03f),new Color(.2f,.18f,.3f));root.AddComponent<AvatarMotion>();return root;}
  static GameObject MakePortal(){var root=new GameObject("Original violet rift");for(int side=0;side<2;side++)for(int i=0;i<9;i++)Cube(root.transform,new Vector3(side==0?-.38f:.38f,.06f+i*.1f,0),Vector3.one*.095f,new Color(.1f,.07f,.15f));for(int side=0;side<2;side++)for(int i=0;i<7;i++)Cube(root.transform,new Vector3(-.3f+i*.1f,side==0?0:.92f,0),Vector3.one*.095f,new Color(.1f,.07f,.15f));var energy=Cube(root.transform,new Vector3(0,.46f,0),new Vector3(.67f,.85f,.025f),new Color(.55f,.19f,.9f));var material=energy.GetComponent<Renderer>().material;material.EnableKeyword("_EMISSION");material.SetColor("_EmissionColor",new Color(.4f,.05f,.7f));return root;}
  void OnApplicationPause(bool paused){if(paused)StopCapture();}
  void OnDestroy(){if(Consented)StopCapture();}
 }
 public sealed class AvatarMotion : MonoBehaviour {public string motion="idle";public bool reduced;void Update(){if(reduced)return;var y=motion=="dance"?Mathf.Sin(Time.time*7)*10:0;transform.localRotation=Quaternion.Euler(0,y,motion=="wave"?Mathf.Sin(Time.time*9)*8:0);}}
}
