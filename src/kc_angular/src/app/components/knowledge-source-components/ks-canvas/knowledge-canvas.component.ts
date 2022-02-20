/**
 Copyright 2022 Rob Royce

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

 http://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
 */


import {Component, EventEmitter, Input, OnDestroy, OnInit, Output} from '@angular/core';
import {ProjectModel, ProjectUpdateRequest} from "src/app/models/project.model";
import {KnowledgeSource} from "../../../models/knowledge.source.model";
import {ProjectService} from "../../../services/factory-services/project-service/project.service";
import {BrowserViewDialogService} from "../../../services/ipc-services/browser-service/browser-view-dialog.service";
import {ElectronIpcService} from "../../../services/ipc-services/electron-ipc/electron-ipc.service";
import {Clipboard} from "@angular/cdk/clipboard";
import {UuidModel} from "../../../models/uuid.model";
import {KsCommandService} from "../../../services/command-services/ks-command/ks-command.service";
import {Subscription} from "rxjs";
import {ConfirmationService, TreeNode} from "primeng/api";
import {NotificationsService} from "../../../services/user-services/notification-service/notifications.service";

@Component({
  selector: 'app-knowledge-canvas',
  templateUrl: './knowledge-canvas.component.html',
  styleUrls: ['./knowledge-canvas.component.scss']
})
export class KnowledgeCanvasComponent implements OnInit, OnDestroy {
  @Input() projectTreeNodes: TreeNode[] = [];
  @Output() ksAdded = new EventEmitter<KnowledgeSource[]>();
  @Output() kcProjectUpdate = new EventEmitter<ProjectModel>();
  @Output() kcSetCurrentProject = new EventEmitter<string>();
  @Output() kcEditProject = new EventEmitter<UuidModel>();
  @Output() onProjectCreation = new EventEmitter<UuidModel | undefined>();
  @Output() onProjectRemove = new EventEmitter<UuidModel>();
  @Output() onTopicSearch = new EventEmitter<string>();
  kcProject: ProjectModel | null = null;
  currentKs?: KnowledgeSource;
  ksMoveTarget?: KnowledgeSource[];
  ksDetailsVisible: boolean = false;
  readonly KS_INFO_DIALOG_WIDTH = '850px';
  readonly KS_INFO_DIALOG_HEIGHT = '700px';
  ksInfoMaximized: boolean = false;
  ksMoveVisible: boolean = false;
  private currentKsOriginal?: string;
  private _subKsCommandDetail: Subscription;
  private _subKsCommandPreview: Subscription;
  private _subKsCommandRemove: Subscription;
  private _subKsCommandMove: Subscription;
  private _subKsCommandOpen: Subscription;
  private _subKsCommandShare: Subscription;
  private _subKsCommandCopyPath: Subscription;
  private _subKsCommandCopyJSON: Subscription;
  private _subKsCommandUpdate: Subscription;
  private _subKsCommandShowInFiles: Subscription;


  constructor(private ksCommandService: KsCommandService,
              private browserViewDialogService: BrowserViewDialogService,
              private projectService: ProjectService,
              private confirmationService: ConfirmationService,
              private ipcService: ElectronIpcService,
              private notificationService: NotificationsService,
              private clipboard: Clipboard) {
    projectService.currentProject.subscribe((project) => {
      this.kcProject = project;
    });

    this._subKsCommandDetail = this.ksCommandService.ksDetailEvent.subscribe((ks) => {
      if (ks) {
        this.currentKs = ks;
        this.ksDetailsVisible = true;
      }
    });

    this._subKsCommandPreview = this.ksCommandService.ksPreviewEvent.subscribe((ks) => {
      if (!ks) {
        return;
      }
      this.onKsPreview(ks);
    });

    this._subKsCommandRemove = this.ksCommandService.ksRemoveEvent.subscribe((ksList) => {
      if (!ksList.length) {
        return;
      }

      this.confirmationService.confirm({
        message: `Are you sure you want to remove ${ksList.length} Knowledge Sources?`,
        accept: () => {
          let updates: ProjectUpdateRequest[] = [];

          ksList.forEach((ks) => {
            let proj = updates.find(p => p.id.value === ks.associatedProject.value);
            if (proj) {
              if (proj.removeKnowledgeSource) {
                proj.removeKnowledgeSource.push(ks);
              }
            } else {
              updates.push({
                id: ks.associatedProject,
                removeKnowledgeSource: [ks]
              })
            }
          });
          this.projectService.updateProjects(updates);
        }
      });
    });

    this._subKsCommandMove = this.ksCommandService.ksMoveEvent.subscribe((ksList) => {
      if (!ksList || !ksList.length) {
        return;
      }
      this.ksMoveTarget = ksList;
      this.ksMoveVisible = true;
    })

    this._subKsCommandOpen = this.ksCommandService.ksOpenEvent.subscribe((ks) => {
      if (!ks) {
        return;
      }
      this.onKsOpen(ks);
    });

    this._subKsCommandShare = this.ksCommandService.ksShareEvent.subscribe((_) => {
      console.warn('KsCommandShare is not implemented yet...');
    });

    this._subKsCommandCopyPath = this.ksCommandService.ksCopyPathEvent.subscribe((ksList) => {
      let paths = [];
      for (let ks of ksList) {
        paths.push(typeof ks.accessLink === 'string' ? ks.accessLink : ks.accessLink.href);
      }
      this.clipboard.copy(paths.join('\n'));
    });

    this._subKsCommandCopyJSON = this.ksCommandService.ksCopyJSONEvent.subscribe((ksList) => {
      if (ksList.length) {
        this.clipboard.copy(JSON.stringify(ksList));
      }
    });

    this._subKsCommandUpdate = this.ksCommandService.ksUpdateEvent.subscribe((ksList) => {
      let updates: ProjectUpdateRequest[] = [];

      for (let ks of ksList) {
        if (ks.associatedProject) {
          let project = this.projectService.getProject(ks.associatedProject.value);
          if (project) {
            ks.dateModified.push(new Date);
            let req: ProjectUpdateRequest = {
              id: project.id,
              updateKnowledgeSource: [ks]
            }
            updates.push(req);
          }
        }
      }

      if (updates.length > 0) {
        this.projectService.updateProjects(updates).then((_) => {
        }).catch((reason) => {
          console.error(reason);
        });
      }
    });

    this._subKsCommandShowInFiles = this.ksCommandService.ksShowInFilesEvent.subscribe((ks) => {
      if (typeof ks.accessLink !== "string") {
        return;
      }
      this.ipcService.showItemInFolder(ks.accessLink);
    });
  }

  ngOnInit(): void {
  }

  ngOnDestroy() {
    this._subKsCommandDetail.unsubscribe();
    this._subKsCommandPreview.unsubscribe();
    this._subKsCommandRemove.unsubscribe();
    this._subKsCommandOpen.unsubscribe();
    this._subKsCommandShare.unsubscribe();
    this._subKsCommandCopyPath.unsubscribe();
    this._subKsCommandCopyJSON.unsubscribe();
    this._subKsCommandUpdate.unsubscribe();
    this._subKsCommandShowInFiles.unsubscribe();
    this._subKsCommandMove.unsubscribe();
  }

  onKsInfoShow(_: any) {
    // Preserve KS as string, to be compared later to check for changes
    if (this.currentKs) {
      this.currentKsOriginal = JSON.stringify(this.currentKs);
    }
  }

  onKsInfoHide(ks: KnowledgeSource) {
    // Check for changes
    if (JSON.stringify(ks) === this.currentKsOriginal) {
      return;
    }

    ks.dateModified.push(new Date());
    let update: ProjectUpdateRequest = {
      id: ks.associatedProject,
      updateKnowledgeSource: [ks]
    }
    this.projectService.updateProjects([update]);
  }

  onKsInfoMaximize($event: any) {
    if ($event.maximized === undefined) {
      console.error('Ks Info Dialog was maximized but event handler is invalid...');
      return;
    }
    this.ksInfoMaximized = $event.maximized;
  }

  onKsMoveHide(_?: KnowledgeSource[]) {
  }

  onKsPreview(ks: KnowledgeSource) {
    const dialogRef = this.browserViewDialogService.open({ks: ks});
    if (dialogRef === undefined) {
      this.notificationService.toast({
        severity: 'warn',
        summary: 'Preview',
        detail: `Oops! It looks like we can't generate a preview for that.`,
        life: 5000
      });

      this.ksCommandService.open(ks);
    }
    console.warn('Need to do something after preview command is received...');
  }

  onKsOpen(ks: KnowledgeSource) {
    // TODO IMPORTANT: this fails when a file has weird characters like #, so files should probably be opened using Electron IPC
    window.open(typeof ks.accessLink === 'string' ? ks.accessLink : ks.accessLink.href);
    ks.dateAccessed.push(new Date());
  }

  onKsRemoveFromMoveList(ks: KnowledgeSource) {
    this.ksMoveTarget = this.ksMoveTarget?.filter(k => k.id.value !== ks.id.value);
  }

  onKsProjectChange($event: { ks: KnowledgeSource; old: string; new: string }) {
    this.projectService.updateProjects([
      {
        id: new UuidModel($event.old),
        moveKnowledgeSource: {ks: $event.ks, new: new UuidModel($event.new)}
      }
    ]);
  }

  onKsEdit($event: KnowledgeSource) {
    this.ksCommandService.detail($event);
  }
}
