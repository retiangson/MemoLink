def register_models() -> None:
    import memolink_backend.domain.models.conversation  # noqa: F401
    import memolink_backend.domain.models.embedding  # noqa: F401
    import memolink_backend.domain.models.message  # noqa: F401
    import memolink_backend.domain.models.note  # noqa: F401
    import memolink_backend.domain.models.reminder  # noqa: F401
    import memolink_backend.domain.models.user_model  # noqa: F401
    import memolink_backend.domain.models.workspace  # noqa: F401
