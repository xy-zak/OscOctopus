<script lang="ts">
  // The one confirmation dialog (see confirmAction in state/ui.svelte.ts). A TUI box over a
  // dithered backdrop (.modal, app.css). Only the confirm button resolves true; Esc, CANCEL and
  // clicking the backdrop all resolve false. Focus starts on CANCEL so a stray Enter can't
  // confirm.
  import { ui } from '../state/ui.svelte';

  let cancelBtn = $state<HTMLButtonElement>();
  $effect(() => {
    if (ui.confirm) cancelBtn?.focus();
  });

  function onkeydown(e: KeyboardEvent) {
    if (!ui.confirm) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      ui.confirm.resolve(false);
    }
  }
</script>

<svelte:window {onkeydown} />

{#if ui.confirm}
  {@const c = ui.confirm}
  <div
    class="modal-backdrop"
    role="presentation"
    onpointerdown={(e) => e.target === e.currentTarget && c.resolve(false)}
  >
    <div
      class="modal"
      class:danger={c.danger}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
    >
      <span id="confirm-title" class="modal-title">{c.title}</span>
      <p class="message">{c.message}</p>
      {#each c.details ?? [] as line (line)}
        <p class="detail">· {line}</p>
      {/each}
      <div class="modal-actions">
        <button class="btn" bind:this={cancelBtn} onclick={() => c.resolve(false)}
          >{c.cancelLabel}</button
        >
        <button
          class="btn"
          class:primary={!c.danger}
          class:danger-fill={c.danger}
          onclick={() => c.resolve(true)}>{c.confirmLabel}</button
        >
      </div>
    </div>
  </div>
{/if}

<style>
  .danger {
    border-color: var(--danger);
  }
  .danger .modal-title {
    background: var(--danger);
    color: var(--bg);
  }
  p {
    margin: 0 0 6px;
  }
  .detail {
    color: var(--fg-dim);
  }
  .danger-fill {
    background: var(--danger);
    border-color: var(--danger);
    color: var(--bg);
    font-weight: 700;
  }
</style>
