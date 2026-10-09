<script lang="ts">
  // GLOBAL SETTINGS › LIBRARY: the projects (snapshots of the whole setup, saved by hand:
  // state/projects.svelte.ts), and every saved desk preset on this device, open or not. Save,
  // load, export or import a project; open a desk, jump to an open one, delete, create a blank
  // desk, or import a file as a new desk.
  import { onMount } from 'svelte';
  import { PROJECT_NAME } from '../lib/model/project';
  import { presetStore } from '../lib/state/preset.svelte';
  import { projectStore } from '../lib/state/projects.svelte';
  import { showDesk, toast } from '../lib/state/ui.svelte';
  import Icon from '../lib/ui/Icon.svelte';
  import Lockable from '../lib/ui/Lockable.svelte';
  import Panel from '../lib/ui/Panel.svelte';
  import { plural } from '../lib/util';
  import { addDesk, deletePreset, importAsDesk, openDesk } from './deskActions';
  import {
    deleteProject,
    exportProject,
    importProject,
    loadProject,
    saveOverProject,
    saveProject,
  } from './projectActions';

  let newName = $state('');
  let projectName = $state('');

  onMount(() => {
    projectStore
      .refresh()
      .catch((e: unknown) => toast(`Could not list projects: ${String(e)}`, 'error'));
  });

  async function newProject() {
    if (await saveProject(projectName)) projectName = '';
  }

  const goToDesk = (id: string) => {
    presetStore.activate(id);
    showDesk('controls');
  };

  async function openAsDesk(id: string, name: string) {
    if (await openDesk(id, name)) toast(`Opened "${name}" as a desk`);
  }

  async function newDesk() {
    if (!(await addDesk(newName.trim()))) return;
    newName = '';
    goToDesk(presetStore.current.id);
  }
</script>

<div class="page scroll">
  <Lockable>
    <Panel
      tour="projects"
      title="Projects · this device"
      hint="A project is the whole setup at once: the open desks with their networks, which one is shown, and the look (palettes and skins included). It is saved only when you save it. Loading one opens its desks as they were saved."
    >
      {#snippet actions()}<span class="faint">{projectStore.summaries.length} saved</span>{/snippet}
      <ul>
        {#each projectStore.summaries as p (p.fileName)}
          <li class:broken={p.error}>
            <span class="mark">·</span>
            <div class="info">
              <span class="name entity-name">{p.name}</span>
              <span class="faint"
                >{p.error ? p.fileName : `${plural(p.desks, 'desk')} · ${p.fileName}`}{p.savedAt
                  ? ` · ${new Date(p.savedAt).toLocaleString()}`
                  : ''}</span
              >
              {#if p.error}<span class="error-text">{p.error}</span>{/if}
            </div>
            <div class="row">
              {#if !p.error}
                <button class="btn" onclick={() => loadProject(p.id, p.name)}
                  ><Icon name="upload" /> Load</button
                >
                <button
                  class="btn ghost"
                  data-tip="Replace it with the desks and look as they are now"
                  onclick={() => saveOverProject(p.id, p.name)}
                  ><Icon name="save" /> Save over</button
                >
                <button class="btn ghost" onclick={() => exportProject(p.id, p.name)}
                  ><Icon name="download" /> Export…</button
                >
              {/if}
              <button
                class="btn icon ghost danger"
                data-tip="Delete project"
                aria-label="Delete project {p.name}"
                onclick={() => deleteProject(p.id, p.name)}><Icon name="trash" /></button
              >
            </div>
          </li>
        {:else}
          <li class="empty faint">No projects yet: save the setup as one below.</li>
        {/each}
      </ul>
      <div class="row" data-tour="project-save">
        <input
          class="input"
          placeholder="Project name"
          maxlength={PROJECT_NAME.max}
          bind:value={projectName}
          onkeydown={(e) => e.key === 'Enter' && projectName.trim() && newProject()}
        />
        <button
          class="btn primary"
          disabled={!projectName.trim()}
          data-tip="Save the open desks and the look as a new project"
          onclick={newProject}><Icon name="save" /> Save project</button
        >
        <button class="btn" onclick={importProject}><Icon name="upload" /> Import project…</button>
      </div>
    </Panel>

    <Panel
      tour="library-desks"
      title="Saved desk presets · this device"
      hint="■ = open as a desk. Stored in {presetStore.dir}"
    >
      {#snippet actions()}<span class="faint">{presetStore.summaries.length} saved</span>{/snippet}
      <ul>
        {#each presetStore.summaries as s (s.fileName)}
          {@const open = presetStore.isOpen(s.id)}
          <li class:open class:broken={s.error}>
            <span class="mark">{open ? '■' : '·'}</span>
            <div class="info">
              <span class="name entity-name">{s.name}</span>
              <span class="faint"
                >{s.fileName}{s.updatedAt
                  ? ` · ${new Date(s.updatedAt).toLocaleString()}`
                  : ''}</span
              >
              {#if s.error}<span class="error-text">{s.error}</span>{/if}
            </div>
            <div class="row">
              {#if open}
                <button class="btn" onclick={() => goToDesk(s.id)}>Go to desk</button>
              {:else if !s.error}
                <button class="btn" onclick={() => openAsDesk(s.id, s.name)}>Open as desk</button>
              {/if}
              <button
                class="btn icon ghost danger"
                data-tip="Delete preset"
                onclick={() => deletePreset(s.id, s.name)}><Icon name="trash" /></button
              >
            </div>
          </li>
        {/each}
      </ul>
      <div class="row">
        <input class="input" placeholder="New desk name" bind:value={newName} />
        <button class="btn primary" disabled={!newName.trim()} onclick={newDesk}
          ><Icon name="file" /> New blank desk</button
        >
        <button class="btn" onclick={importAsDesk}
          ><Icon name="upload" /> Import as new desk…</button
        >
      </div>
    </Panel>
  </Lockable>
</div>

<style>
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li.empty {
    display: block;
  }
  li {
    display: grid;
    grid-template-columns: 1ch 1fr auto;
    align-items: center;
    gap: 1ch;
    padding: 6px 0.5ch;
    border-bottom: 1px dashed var(--line);
  }
  .mark {
    color: var(--fg-faint);
  }
  li.open .mark,
  li.open .name {
    color: var(--accent-text);
  }
  .info {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 1ch;
  }
  .row .input {
    flex: 1;
    min-width: 20ch;
  }
</style>
